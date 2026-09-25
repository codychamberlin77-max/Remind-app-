import { simpleParser } from "mailparser";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import type { AcceptedKind } from "../validateFile";

/**
 * What the extraction pipeline sees. Text is always preferred: most documents
 * never need a vision call, which is faster, cheaper, and sends less data out.
 */
export type NormalizedDocument = {
  text: string;
  /** Present only when text extraction was insufficient (photos, scanned PDFs). */
  visual?: { kind: "image"; mimeType: "image/jpeg"; data: Buffer } | { kind: "pdf"; mimeType: "application/pdf"; data: Buffer };
  pageCount: number | null;
  /** Normalized image bytes (EXIF stripped) to store in place of the original upload. */
  sanitizedImage?: Buffer;
  meta: { sourceKind: AcceptedKind; emailSubject?: string; emailFrom?: string; emailDate?: string };
};

export class NormalizationError extends Error {
  constructor(
    public code: "malformed" | "encrypted" | "no_content",
    message: string,
  ) {
    super(message);
  }
}

const MIN_TEXT_CHARS_PER_PAGE = 40;

export async function normalizePdf(buf: Buffer): Promise<NormalizedDocument> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/password/i.test(msg)) throw new NormalizationError("encrypted", "This PDF is password-protected.");
    throw new NormalizationError("malformed", "This PDF appears to be damaged.");
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const clean = cleanText(text);
  if (clean.length >= MIN_TEXT_CHARS_PER_PAGE * Math.min(totalPages, 2)) {
    return { text: clean, pageCount: totalPages, meta: { sourceKind: "pdf" } };
  }
  // Scanned PDF: let a vision-capable model read the pages.
  return {
    text: clean,
    visual: { kind: "pdf", mimeType: "application/pdf", data: buf },
    pageCount: totalPages,
    meta: { sourceKind: "pdf" },
  };
}

/**
 * Re-encode images: applies EXIF orientation then drops ALL metadata (GPS,
 * device, timestamps), downsizes for the model, and neutralizes polyglot files.
 */
export async function normalizeImage(buf: Buffer): Promise<NormalizedDocument> {
  let out: Buffer;
  try {
    out = await sharp(buf, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new NormalizationError("malformed", "We couldn't open this image.");
  }
  return {
    text: "",
    visual: { kind: "image", mimeType: "image/jpeg", data: out },
    sanitizedImage: out,
    pageCount: 1,
    meta: { sourceKind: "image" },
  };
}

export async function normalizeEmail(buf: Buffer): Promise<NormalizedDocument> {
  const mail = await simpleParser(buf, { skipImageLinks: true, skipTextToHtml: true });
  const body = mail.text?.trim() || htmlToText(typeof mail.html === "string" ? mail.html : "");
  const parts = [
    mail.subject ? `Subject: ${mail.subject}` : null,
    mail.from?.text ? `From: ${mail.from.text}` : null,
    mail.date ? `Date: ${mail.date.toISOString().slice(0, 10)}` : null,
    "",
    body,
  ].filter((p) => p !== null);

  // Forwarded receipts often arrive as PDF attachments.
  for (const att of mail.attachments ?? []) {
    if (att.contentType === "application/pdf" && att.size < 10 * 1024 * 1024) {
      try {
        const pdf = await normalizePdf(att.content);
        if (pdf.text) parts.push("", `--- Attachment: ${att.filename ?? "document.pdf"} ---`, pdf.text);
      } catch {
        /* ignore unreadable attachments */
      }
    }
  }
  const text = cleanText(parts.join("\n"));
  if (!text) throw new NormalizationError("no_content", "This email has no readable content.");
  return {
    text,
    pageCount: 1,
    meta: {
      sourceKind: "email",
      emailSubject: mail.subject ?? undefined,
      emailFrom: mail.from?.text ?? undefined,
      emailDate: mail.date?.toISOString().slice(0, 10),
    },
  };
}

export async function normalizeText(buf: Buffer): Promise<NormalizedDocument> {
  const text = cleanText(buf.toString("utf8"));
  if (!text) throw new NormalizationError("no_content", "This file has no readable text.");
  return { text, pageCount: 1, meta: { sourceKind: "text" } };
}

export async function normalize(kind: AcceptedKind, buf: Buffer): Promise<NormalizedDocument> {
  switch (kind) {
    case "pdf":
      return normalizePdf(buf);
    case "image":
      return normalizeImage(buf);
    case "email":
      return normalizeEmail(buf);
    case "text":
      return normalizeText(buf);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
