import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeImage } from "@/server/ingestion/normalize";
import { safeDisplayName } from "@/server/ingestion/ingest";
import { validateFile } from "@/server/ingestion/validateFile";
import { redact } from "@/server/privacy/redact";

const MB = 1024 * 1024;

describe("file validation", () => {
  it("accepts real PDFs, images, emails, text by content", async () => {
    expect((await validateFile(Buffer.from("%PDF-1.7\n..."), MB)).ok).toBe(true);
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(await validateFile(png, MB)).toMatchObject({ ok: true, kind: "image" });
    expect(await validateFile(Buffer.from("From: a@b.c\nTo: d@e.f\nSubject: hi\nDate: x\n\nbody"), MB)).toMatchObject({ ok: true, kind: "email" });
    expect(await validateFile(Buffer.from("just some notes"), MB)).toMatchObject({ ok: true, kind: "text" });
  });

  it("rejects SVG/HTML/scripts even when renamed", async () => {
    expect(await validateFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), MB)).toMatchObject({ ok: false, code: "dangerous_type" });
    expect(await validateFile(Buffer.from("<!DOCTYPE html><html><script>x</script>"), MB)).toMatchObject({ ok: false, code: "dangerous_type" });
    expect(await validateFile(Buffer.from("#!/bin/sh\nrm -rf /"), MB)).toMatchObject({ ok: false, code: "dangerous_type" });
  });

  it("rejects executables, archives, empty and oversized files", async () => {
    expect(await validateFile(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 0x04, 0, 0, 0, 0xff, 0xff]), MB)).toMatchObject({ ok: false });
    expect(await validateFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0]), MB)).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(await validateFile(Buffer.alloc(0), MB)).toMatchObject({ ok: false, code: "empty" });
    expect(await validateFile(Buffer.alloc(MB + 1, 0x41), MB)).toMatchObject({ ok: false, code: "too_large" });
  });

  it("strips EXIF/GPS from photos", async () => {
    const withGps = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#abc" } })
      .jpeg()
      .withExif({ IFD0: { Make: "TestPhone", Model: "X" }, IFD3: { GPSLatitude: "40/1 44/1 0/1", GPSLatitudeRef: "N" } })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeTruthy();
    const out = await normalizeImage(withGps);
    const meta = await sharp(out.sanitizedImage!).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("sanitizes display names", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName('<script>"x".pdf')).toBe("scriptx.pdf");
  });
});

describe("redaction before AI calls", () => {
  it("masks card numbers (Luhn-valid only), SSNs, and the user's identity", () => {
    const { text, report } = redact("Card 4111 1111 1111 1111, order 1234567890123, SSN 123-45-6789, Ada Lovelace ada@example.com", {
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(text).toContain("•••• 1111");
    expect(text).toContain("order 1234567890123"); // not Luhn-valid → kept
    expect(text).toContain("[redacted-ssn]");
    expect(text).toContain("[your name]");
    expect(text).toContain("[your email]");
    expect(report.cards).toBe(1);
  });
});
