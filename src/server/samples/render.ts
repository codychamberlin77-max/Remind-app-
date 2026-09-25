import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Render plain text lines to a simple one-page PDF with a real text layer. */
export async function renderTextPdf(lines: string[], opts: { title?: string } = {}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title ?? "Receipt");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setProducer("LIFEOS sample");
  pdf.setCreator("LIFEOS sample");
  const font = await pdf.embedFont(StandardFonts.Courier);
  const bold = await pdf.embedFont(StandardFonts.CourierBold);
  const page = pdf.addPage([420, Math.max(560, 60 + lines.length * 14)]);
  let y = page.getHeight() - 40;
  for (const raw of lines) {
    const isBold = raw.startsWith("**");
    const line = isBold ? raw.slice(2) : raw;
    page.drawText(line, { x: 28, y, size: 9.5, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.12) });
    y -= 14;
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
