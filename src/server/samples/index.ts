import { addDays, formatDate, weekdayOf } from "@/server/extraction/dates";
import { renderTextPdf } from "./render";

/**
 * Sample documents for the first-run experience. Dates are generated relative
 * to "today" so the demo always shows live deadlines. Samples are processed by
 * the recorded (mock) provider regardless of AI_PROVIDER: instant and free.
 */
export type SampleId = "receipt" | "trial" | "credit";

export const SAMPLE_META: Record<SampleId, { label: string; description: string; filename: string }> = {
  receipt: { label: "Electronics receipt", description: "Best Buy · Samsung TV", filename: "bestbuy-receipt.pdf" },
  trial: { label: "Free-trial email", description: "Streaming service trial", filename: "trial-ending.eml" },
  credit: { label: "Airline credit", description: "Delta eCredit", filename: "delta-ecredit.eml" },
};

const long = (iso: string) => formatDate(iso); // "Sep 22, 2026"
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function buildSample(id: SampleId, today: string): Promise<{ filename: string; bytes: Buffer }> {
  const nonce = today.replaceAll("-", "");
  switch (id) {
    case "receipt": {
      const purchased = addDays(today, -3);
      const lines = [
        "**BEST BUY",
        "Store #1047  Union Square",
        "",
        `Date: ${long(purchased)}   14:32`,
        `Order: BBY01-8064-${nonce}`,
        "",
        "SAMSUNG 65\" CLASS Q80D QLED 4K TV     1,299.99",
        "  SKU 6576345",
        "GEEK SQUAD 2-YEAR PROTECTION PLAN       179.99",
        "  Covers: SAMSUNG 65\" CLASS Q80D",
        "",
        "SUBTOTAL                             1,479.98",
        "SALES TAX 8.875%                       131.35",
        "**TOTAL                                $1,611.33",
        "",
        "VISA ************4821",
        "",
        "Thank you for shopping at Best Buy.",
        "Keep this receipt for your records.",
      ];
      return { filename: SAMPLE_META.receipt.filename, bytes: await renderTextPdf(lines, { title: "Best Buy receipt" }) };
    }
    case "trial": {
      const sent = addDays(today, -1);
      // The trial ends on the next weekday name 2–7 days out; the email says only the weekday.
      const ends = addDays(sent, 3);
      const email = [
        "From: StreamMax <billing@streammax.example>",
        "To: you@example.com",
        `Subject: Your free trial ends ${WEEKDAY[weekdayOf(ends)]}`,
        `Date: ${new Date(`${sent}T15:04:00Z`).toUTCString()}`,
        `Message-ID: <trial-${nonce}@streammax.example>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hi there,",
        "",
        `Your StreamMax Premium free trial ends ${WEEKDAY[weekdayOf(ends)]} and will renew for $19.99/month.`,
        "",
        "If you'd like to keep watching, there's nothing you need to do.",
        "To avoid being charged, cancel any time before your trial ends in Account > Membership.",
        "",
        "— The StreamMax team",
      ].join("\r\n");
      return { filename: SAMPLE_META.trial.filename, bytes: Buffer.from(email) };
    }
    case "credit": {
      const issued = addDays(today, -40);
      const expires = addDays(issued, 365);
      const email = [
        "From: Delta Air Lines <deltaairlines@t.delta.example>",
        "To: you@example.com",
        "Subject: Your Delta eCredit",
        `Date: ${new Date(`${issued}T12:00:00Z`).toUTCString()}`,
        `Message-ID: <ecredit-${nonce}@delta.example>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Your trip has been cancelled and the value of your ticket has been saved as an eCredit.",
        "",
        "eCredit amount: $431.00",
        "eCredit number: 0062198473516",
        `Travel must be completed by ${long(expires)}.`,
        "",
        "Use your eCredit at delta.com or in the Fly Delta app.",
      ].join("\r\n");
      return { filename: SAMPLE_META.credit.filename, bytes: Buffer.from(email) };
    }
  }
}
