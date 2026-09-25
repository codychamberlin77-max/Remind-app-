import { fileTypeFromBuffer } from "file-type";

export type AcceptedKind = "pdf" | "image" | "email" | "text";

export type ValidationResult =
  | { ok: true; kind: AcceptedKind; mimeType: string; extension: string }
  | { ok: false; code: "empty" | "too_large" | "unsupported_type" | "dangerous_type"; message: string };

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Things that can execute in a browser or office suite. Rejected even when renamed. */
const DANGEROUS_PATTERNS: RegExp[] = [
  /^\s*<\?xml[\s\S]{0,200}<svg/i,
  /^\s*<svg[\s>]/i,
  /^\s*<!doctype\s+html/i,
  /^\s*<(html|head|body|script|iframe)[\s>]/i,
  /^\s*#!/, // shebang scripts
];

function looksLikeEmail(head: string): boolean {
  const lines = head.split(/\r?\n/).slice(0, 60);
  const headerNames = new Set(
    lines.map((l) => /^([A-Za-z-]+):\s/.exec(l)?.[1]?.toLowerCase()).filter(Boolean) as string[],
  );
  const signals = ["from", "to", "subject", "date", "mime-version", "message-id", "received", "content-type"];
  return signals.filter((s) => headerNames.has(s)).length >= 3 && headerNames.has("from");
}

function isMostlyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  const decoded = sample.toString("utf8");
  const bad = (decoded.match(/�/g) ?? []).length;
  return bad / Math.max(decoded.length, 1) < 0.01;
}

/**
 * Validate an upload by its bytes. The client-declared MIME type and file
 * extension are ignored for security decisions.
 */
export async function validateFile(buf: Buffer, maxBytes: number): Promise<ValidationResult> {
  if (buf.length === 0) return { ok: false, code: "empty", message: "That file is empty." };
  if (buf.length > maxBytes) {
    return {
      ok: false,
      code: "too_large",
      message: `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    };
  }

  const head = buf.subarray(0, 4096).toString("utf8");
  if (DANGEROUS_PATTERNS.some((re) => re.test(head))) {
    return { ok: false, code: "dangerous_type", message: "That file type isn't supported." };
  }

  const sniffed = await fileTypeFromBuffer(buf);
  if (sniffed) {
    if (sniffed.mime === "application/pdf") return { ok: true, kind: "pdf", mimeType: sniffed.mime, extension: "pdf" };
    if (IMAGE_MIMES.has(sniffed.mime)) return { ok: true, kind: "image", mimeType: sniffed.mime, extension: sniffed.ext };
    if (sniffed.mime === "image/heic" || sniffed.mime === "image/heif") {
      return {
        ok: false,
        code: "unsupported_type",
        message: "HEIC photos aren't supported yet. Export as JPEG, or upload from your photo library in the browser.",
      };
    }
    // Recognized binary but not on the allowlist (zip, docx, exe, gif, …).
    return { ok: false, code: "unsupported_type", message: "That file type isn't supported yet." };
  }

  if (!isMostlyText(buf)) {
    return { ok: false, code: "unsupported_type", message: "We couldn't read that file." };
  }
  if (looksLikeEmail(head)) return { ok: true, kind: "email", mimeType: "message/rfc822", extension: "eml" };
  return { ok: true, kind: "text", mimeType: "text/plain", extension: "txt" };
}
