import { simpleParser } from "mailparser";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import { parseDates } from "@/server/extraction/dates";
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

/**
 * A message the user forwarded by hand carries the ORIGINAL sender/date/subject
 * inside the body. Deadlines like "ends Friday" are relative to the original
 * date, not the day it was forwarded, so we surface those as the headers.
 */
export function parseForwardedHeader(body: string): { from?: string; subject?: string; dateIso?: string } | null {
  const marker = /(-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:|_{10,}|-{3,}\s*Original Message\s*-{3,})/i.exec(body);
  if (!marker) return null;
  const after = body.slice(marker.index + marker[0].length).replace(/^\s+/, "");
  const lines = after.split(/\r?\n/).slice(0, 12);
  const get = (re: RegExp) => lines.map((l) => re.exec(l.trim())?.[1]?.trim()).find(Boolean);
  const from = get(/^From:\s*(.+)$/i);
  const subject = get(/^Subject:\s*(.+)$/i);
  const dateRaw = get(/^(?:Date|Sent):\s*(.+)$/i);
  if (!from && !subject && !dateRaw) return null;
  let dateIso: string | undefined;
  if (dateRaw) {
    const cand = parseDates(dateRaw).find((c) => !c.ambiguousWith && !c.yearInferred);
    if (cand) dateIso = cand.iso;
    else {
      const d = new Date(dateRaw.replace(/\s+at\s+/i, " "));
      if (!Number.isNaN(d.getTime())) dateIso = d.toISOString().slice(0, 10);
    }
  }
  return { from, subject, dateIso };
}

export async function normalizeEmail(buf: Buffer): Promise<NormalizedDocument> {
  const mail = await simpleParser(buf, { skipImageLinks: true, skipTextToHtml: true });
  const body = mail.text?.trim() || htmlToText(typeof mail.html === "string" ? mail.html : "");
  const fwd = parseForwardedHeader(body);
  const subject = (fwd?.subject ?? mail.subject ?? "").replace(/^(fwd?|fw):\s*/i, "") || undefined;
  const from = fwd?.from ?? mail.from?.text;
  const dateIso = fwd?.dateIso ?? mail.date?.toISOString().slice(0, 10);
  const parts = [
    subject ? `Subject: ${subject}` : null,
    from ? `From: ${from}` : null,
    dateIso ? `Date: ${dateIso}` : null,
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
    meta: { sourceKind: "email", emailSubject: subject, emailFrom: from ?? undefined, emailDate: dateIso },
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
