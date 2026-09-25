/**
 * Renders the evaluation documents in tests/evals/cases.ts to real files
 * (PDF with a text layer, PNG screenshots, degraded JPEG photos, .eml, .txt)
 * and writes a manifest with each file's SHA-256 (the mock provider matches
 * image recordings by hash). Output is committed so hashes stay stable.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { renderTextPdf } from "../src/server/samples/render";
import { CASES, type FileSpec } from "../tests/evals/cases";

const OUT = "tests/evals/fixtures";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svgFor(lines: string[], opts: { width: number; lineHeight: number; fontSize: number; bg: string; mono: boolean; pad: number }) {
  const height = opts.pad * 2 + lines.length * opts.lineHeight;
  const text = lines
    .map((l, i) => {
      const bold = l.startsWith("**");
      const t = bold ? l.slice(2) : l;
      return `<text x="${opts.pad}" y="${opts.pad + (i + 1) * opts.lineHeight - 6}" font-family="${opts.mono ? "DejaVu Sans Mono" : "DejaVu Sans"}" font-size="${opts.fontSize}" ${bold ? 'font-weight="bold"' : ""} fill="#1a1a1a" xml:space="preserve">${esc(t)}</text>`;
    })
    .join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${height}"><rect width="100%" height="100%" fill="${opts.bg}"/>${text}</svg>`);
}

/** Deterministic noise (seeded LCG) so image hashes are reproducible. */
function noise(width: number, height: number, seed: number, strength: number) {
  const buf = Buffer.alloc(width * height * 3);
  let x = seed >>> 0;
  for (let i = 0; i < buf.length; i += 3) {
    x = (1664525 * x + 1013904223) >>> 0;
    const v = 255 - ((x >>> 24) % strength);
    buf[i] = v;
    buf[i + 1] = v;
    buf[i + 2] = Math.max(0, v - 8);
  }
  return sharp(buf, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function render(spec: FileSpec): Promise<{ bytes: Buffer; ext: string }> {
  switch (spec.kind) {
    case "pdf":
      return { bytes: await renderTextPdf(spec.lines), ext: "pdf" };
    case "txt":
      return { bytes: Buffer.from(spec.text), ext: "txt" };
    case "eml":
      return { bytes: Buffer.from(spec.text), ext: "eml" };
    case "raw":
      return { bytes: Buffer.from(spec.base64, "base64"), ext: spec.ext };
    case "png": {
      const svg = svgFor(spec.lines, { width: 750, lineHeight: 40, fontSize: 24, bg: "#ffffff", mono: false, pad: 40 });
      return { bytes: await sharp(svg).png({ compressionLevel: 9 }).toBuffer(), ext: "png" };
    }
    case "jpg": {
      const svg = svgFor(spec.lines, { width: 560, lineHeight: 34, fontSize: 21, bg: "#f4f1ea", mono: true, pad: 36 });
      const base = sharp(svg).png();
      const meta = await sharp(await base.toBuffer()).metadata();
      const w = meta.width!;
      const h = meta.height!;
      const heavy = spec.style === "unreadable";
      const n = await noise(w, h, 42 + spec.lines.length, heavy ? 200 : 70);
      const img = await sharp(await sharp(svg).png().toBuffer())
        .composite([{ input: n, blend: "multiply" }])
        .blur(heavy ? 7 : 0.7)
        .rotate(heavy ? 9 : 3.5, { background: "#b9b3a8" })
        .jpeg({ quality: heavy ? 35 : 70 })
        .toBuffer();
      return { bytes: img, ext: "jpg" };
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest: Record<string, { file: string; sha256: string }> = {};
  for (const c of CASES) {
    const { bytes, ext } = await render(c.file);
    const file = `${c.id}.${ext}`;
    await writeFile(path.join(OUT, file), bytes);
    manifest[c.id] = { file, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${Object.keys(manifest).length} fixtures to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
