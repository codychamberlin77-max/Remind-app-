import { createReadStream, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PSTFile, PSTFolder, PSTMessage } from "pst-extractor";
import yauzl from "yauzl";
import { parseHeaderBlock } from "./emailHeaders";
import { splitMbox, type MboxMessage } from "./mbox";

export { isAcceptedArchiveName } from "@/lib/mailArchiveNames";

/**
 * Past-email archives, whatever the mail app: every format is turned into one
 * RFC 822 message at a time so the same relevance filter and pipeline apply.
 *
 *   Google Takeout ........ .zip containing .mbox files, or a bare .mbox
 *   Apple Mail ............ "Export Mailbox" → Inbox.mbox/ folder (zipped) with a file named "mbox"
 *   Thunderbird ........... profile mail files with no extension ("Inbox"), bare or zipped
 *   Outlook (Windows) ..... .pst, also what Outlook.com's "Export mailbox" produces
 *   Outlook for Mac ....... .olm (a zip of per-message XML files)
 */

export type ArchiveKind = "zip" | "pst" | "mbox";

const MAX_XML_BYTES = 25 * 1024 * 1024;

export async function detectArchive(file: string): Promise<ArchiveKind> {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(5);
    await fh.read(b, 0, 5, 0);
    if (b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "zip";
    if (b.subarray(0, 4).toString("latin1") === "!BDN") return "pst";
    return "mbox"; // splitMbox finds nothing in a file that isn't one → "no emails found"
  } finally {
    await fh.close();
  }
}

export async function* messagesFromArchive(file: string, tmpDir: string): AsyncGenerator<MboxMessage> {
  const kind = await detectArchive(file);
  if (kind === "pst") yield* messagesFromPst(file);
  else if (kind === "zip") yield* messagesFromZip(file, tmpDir);
  else yield* splitMbox(createReadStream(file));
}

// ───────────────────────────── zip (Takeout, Apple Mail, Thunderbird, .olm) ─────────────────────────────

function isMboxEntry(name: string) {
  const base = path.posix.basename(name);
  if (base.startsWith(".") || name.startsWith("__MACOSX/")) return false;
  return /\.(mbox|mbx)$/i.test(base) || !base.includes(".");
}
function isOlmMessage(name: string) {
  return /com\.microsoft\.__Messages\/.*\.xml$/i.test(name) || /(^|\/)message_\d+\.xml$/i.test(name);
}

type ZipEntry = { name: string; size: number; open: () => Promise<Readable> };

/** Entries one at a time from a single open handle; each stream must be consumed (or destroyed) before the next. */
async function* zipEntries(zipPath: string): AsyncGenerator<ZipEntry> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, z) => (err || !z ? reject(err ?? new Error("bad zip")) : resolve(z))),
  );
  let waiting: ((e: yauzl.Entry | null) => void) | null = null;
  let failure: Error | null = null;
  zip.on("entry", (e: yauzl.Entry) => waiting?.(e));
  zip.on("end", () => waiting?.(null));
  zip.on("error", (err: Error) => {
    failure = err;
    waiting?.(null);
  });
  try {
    for (;;) {
      const entry = await new Promise<yauzl.Entry | null>((resolve) => {
        waiting = resolve;
        zip.readEntry();
      });
      if (failure) throw failure;
      if (!entry) return;
      if (entry.fileName.endsWith("/")) continue;
      yield {
        name: entry.fileName,
        size: entry.uncompressedSize,
        open: () => new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (err, s) => (err || !s ? reject(err ?? new Error("bad entry")) : resolve(s)))),
      };
    }
  } finally {
    zip.close();
  }
}

async function readAll(stream: Readable, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream) {
    n += (c as Buffer).length;
    if (n > max) {
      stream.destroy();
      return null;
    }
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function* messagesFromZip(zipPath: string, tmpDir: string): AsyncGenerator<MboxMessage> {
  let n = 0;
  for await (const entry of zipEntries(zipPath)) {
    if (isOlmMessage(entry.name)) {
      if (entry.size > MAX_XML_BYTES) {
        yield { raw: Buffer.alloc(0), oversized: true };
        continue;
      }
      const xml = await readAll(await entry.open(), MAX_XML_BYTES);
      const raw = xml ? olmToRaw(xml.toString("utf8")) : null;
      if (raw) yield { raw, oversized: false };
    } else if (/\.(pst|ost)$/i.test(entry.name)) {
      // A .pst inside a zip (e.g. a downloaded Outlook.com export): extract, then read.
      const out = path.join(tmpDir, `inner-${n++}.pst`);
      try {
        await pipeline(await entry.open(), createWriteStream(out, { mode: 0o600 }));
        yield* messagesFromPst(out);
      } finally {
        await rm(out, { force: true });
      }
    } else if (isMboxEntry(entry.name)) {
      yield* splitMbox(await entry.open());
    }
  }
}

// ───────────────────────────── Outlook .pst ─────────────────────────────

function encodeHeader(s: string) {
  const clean = s.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** Build a plain RFC 822 message from already-decoded parts. */
export function buildRawEmail(m: {
  from: string;
  subject: string;
  date: Date | null;
  messageId?: string | null;
  extraHeaders?: Record<string, string>;
  text?: string | null;
  html?: string | null;
}): Buffer {
  const headers: string[] = [
    `From: ${encodeHeader(m.from || "unknown@unknown.invalid")}`,
    `Subject: ${encodeHeader(m.subject)}`,
    ...(m.date && !Number.isNaN(m.date.getTime()) ? [`Date: ${m.date.toUTCString()}`] : []),
    ...(m.messageId ? [`Message-ID: ${m.messageId.replace(/[\r\n]/g, "")}`] : []),
    ...Object.entries(m.extraHeaders ?? {}).map(([k, v]) => `${k}: ${v.replace(/[\r\n]+/g, " ")}`),
    "MIME-Version: 1.0",
  ];
  const useHtml = !m.text?.trim() && !!m.html?.trim();
  headers.push(`Content-Type: ${useHtml ? "text/html" : "text/plain"}; charset=utf-8`, "Content-Transfer-Encoding: 8bit");
  const body = (useHtml ? m.html : m.text) ?? "";
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body.replace(/\r?\n/g, "\r\n")}\r\n`, "utf8");
}

function pstMessageToRaw(msg: PSTMessage): Buffer {
  // The original internet headers, when Outlook kept them, carry the signals the relevance filter uses.
  const orig = msg.transportMessageHeaders ? parseHeaderBlock(msg.transportMessageHeaders) : {};
  const extra: Record<string, string> = {};
  if (orig["list-unsubscribe"]) extra["List-Unsubscribe"] = orig["list-unsubscribe"];
  if (orig["precedence"]) extra["Precedence"] = orig["precedence"];
  const fromAddr = msg.senderEmailAddress && msg.senderEmailAddress.includes("@") ? msg.senderEmailAddress : null;
  const from = orig["from"] ?? (fromAddr ? `${msg.senderName ? `${msg.senderName} ` : ""}<${fromAddr}>` : msg.senderName);
  return buildRawEmail({
    from,
    subject: msg.subject ?? "",
    date: msg.messageDeliveryTime ?? msg.clientSubmitTime ?? (orig["date"] ? new Date(orig["date"]) : null),
    messageId: msg.internetMessageId || orig["message-id"] || null,
    extraHeaders: extra,
    text: msg.body,
    html: msg.bodyHTML,
  });
}

async function* messagesFromPst(file: string): AsyncGenerator<MboxMessage> {
  const pst = new PSTFile(file);
  try {
    const stack: PSTFolder[] = [pst.getRootFolder()];
    let n = 0;
    while (stack.length) {
      const folder = stack.pop()!;
      if (folder.hasSubfolders) stack.push(...folder.getSubFolders());
      if (folder.contentCount <= 0) continue;
      folder.moveChildCursorTo(0);
      for (;;) {
        let child: unknown;
        try {
          child = folder.getNextChild();
        } catch {
          break; // corrupt folder table: skip the rest of this folder
        }
        if (!child) break;
        if (!(child instanceof PSTMessage) || !/^IPM\.Note/i.test(child.messageClass || "IPM.Note")) continue;
        try {
          yield { raw: pstMessageToRaw(child), oversized: false };
        } catch {
          yield { raw: Buffer.alloc(0), oversized: true }; // count it, skip it
        }
        // Parsing is synchronous: let the event loop breathe on large files.
        if (++n % 100 === 0) await new Promise((r) => setImmediate(r));
      }
    }
  } finally {
    pst.close();
  }
}

// ───────────────────────────── Outlook for Mac .olm ─────────────────────────────

function unescapeXml(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? unescapeXml(m[1]!).trim() : null;
}
function attr(xml: string, element: string, name: string): string | null {
  const el = new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`, "i").exec(xml)?.[1] ?? "";
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(el);
  return m ? unescapeXml(m[1]!) : null;
}

/** One .olm message XML → RFC 822. Returns null for non-message XML. */
export function olmToRaw(xml: string): Buffer | null {
  if (!/<email\b|OPFMessageCopy/i.test(xml)) return null;
  const subject = tag(xml, "OPFMessageCopySubject") ?? "";
  const addr = attr(xml, "OPFMessageCopySenderAddress", "OPFContactEmailAddressAddress") ?? attr(xml, "OPFMessageCopyFromAddresses", "OPFContactEmailAddressAddress");
  const name = attr(xml, "OPFMessageCopySenderAddress", "OPFContactEmailAddressName") ?? attr(xml, "OPFMessageCopyFromAddresses", "OPFContactEmailAddressName");
  const when = tag(xml, "OPFMessageCopySentTime") ?? tag(xml, "OPFMessageCopyReceivedTime");
  const html = tag(xml, "OPFMessageCopyHTMLBody");
  const body = tag(xml, "OPFMessageCopyBody");
  if (!subject && !addr && !body && !html) return null;
  const bodyIsHtml = !!body && /<\/?(html|div|p|br|table)\b/i.test(body);
  return buildRawEmail({
    from: addr ? `${name ? `${name} ` : ""}<${addr}>` : name ?? "",
    subject,
    date: when ? new Date(when) : null,
    messageId: tag(xml, "OPFMessageCopyMessageID"),
    text: bodyIsHtml ? null : body,
    html: html ?? (bodyIsHtml ? body : null),
  });
}
