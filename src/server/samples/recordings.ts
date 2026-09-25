import type { MockRecording } from "@/server/ai/providers/mock";
import { parseDates } from "@/server/extraction/dates";

/**
 * Recorded model responses for the built-in samples. Values are computed from
 * the sample text itself (dates are relative to the day the sample was made),
 * mirroring what a real model returns for these documents.
 */
const f = (value: unknown, evidence: string | null, confidence = 0.95) => ({ value, evidence, confidence });
const none = { value: null, evidence: null, confidence: 0 };

function firstDate(text: string, re: RegExp): { iso: string; evidence: string } | null {
  const m = re.exec(text);
  if (!m) return null;
  const iso = parseDates(m[1]!)[0]?.iso;
  return iso ? { iso, evidence: m[1]! } : null;
}

export const SAMPLE_RECORDINGS: MockRecording[] = [
  {
    id: "sample-bestbuy",
    match: { textIncludes: "Order: BBY01-8064-" },
    classify: { document_type: "purchase_receipt", confidence: 0.98, is_actionable: true, reason: "Store receipt for electronics." },
    extract: (text: string) => {
      const d = firstDate(text, /Date: ([A-Z][a-z]{2} \d{1,2}, \d{4})/);
      const order = /Order: (BBY01-8064-\d+)/.exec(text)?.[1] ?? null;
      return {
        orders: [
          {
            merchant: f("Best Buy", "BEST BUY", 0.99),
            purchase_date: d ? f(d.iso, `Date: ${d.evidence}`, 0.97) : none,
            order_number: order ? f(order, `Order: ${order}`, 0.97) : none,
            line_items: [
              { name: 'SAMSUNG 65" CLASS Q80D QLED 4K TV', quantity: 1, total_price: 1299.99, evidence: 'SAMSUNG 65" CLASS Q80D QLED 4K TV 1,299.99', confidence: 0.96 },
              { name: "GEEK SQUAD 2-YEAR PROTECTION PLAN", quantity: 1, total_price: 179.99, evidence: "GEEK SQUAD 2-YEAR PROTECTION PLAN 179.99", confidence: 0.96 },
            ],
            subtotal: { value: 1479.98, currency: "USD", evidence: "SUBTOTAL 1,479.98", confidence: 0.97 },
            tax: { value: 131.35, currency: "USD", evidence: "SALES TAX 8.875% 131.35", confidence: 0.95 },
            total: { value: 1611.33, currency: "USD", evidence: "TOTAL $1,611.33", confidence: 0.98 },
            payment_last4: f("4821", "VISA ************4821", 0.95),
            return_policy: { return_days: none, return_by_date: none, policy_text: none },
            warranty: {
              duration_months: f(24, "GEEK SQUAD 2-YEAR PROTECTION PLAN", 0.9),
              provider: f("Geek Squad", "GEEK SQUAD 2-YEAR PROTECTION PLAN", 0.9),
              ends_on: none,
              covered_item: f('SAMSUNG 65" CLASS Q80D', 'Covers: SAMSUNG 65" CLASS Q80D', 0.9),
            },
          },
        ],
      };
    },
  },
  {
    id: "sample-trial",
    match: { textIncludes: "StreamMax Premium free trial ends" },
    classify: { document_type: "subscription", confidence: 0.97, is_actionable: true, reason: "Free trial ending notice." },
    extract: (text: string) => {
      const sent = /Date: (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null;
      const phrase = /(Your StreamMax Premium free trial ends \w+day)/.exec(text)?.[1] ?? null;
      const endIso = sent && phrase ? parseDates(phrase, { referenceIso: sent }).find((c) => c.form === "weekday")?.iso ?? null : null;
      return {
        service_name: f("StreamMax Premium", "Your StreamMax Premium free trial", 0.97),
        plan_name: f("Premium", "StreamMax Premium", 0.9),
        amount: { value: 19.99, currency: "USD", evidence: "renew for $19.99/month", confidence: 0.97 },
        billing_period: f("monthly", "$19.99/month", 0.96),
        status: f("trial", "free trial ends", 0.95),
        trial_end_date: endIso ? f(endIso, phrase, 0.9) : none,
        next_renewal_date: endIso ? f(endIso, phrase, 0.85) : none,
        email_sent_date: sent ? f(sent, `Date: ${sent}`, 0.95) : none,
      };
    },
  },
  {
    id: "sample-delta",
    match: { textIncludes: "value of your ticket has been saved as an eCredit" },
    classify: { document_type: "travel_credit", confidence: 0.98, is_actionable: true, reason: "Airline eCredit notice." },
    extract: (text: string) => {
      const exp = firstDate(text, /Travel must be completed by ([A-Z][a-z]{2} \d{1,2}, \d{4})/);
      const sent = /Date: (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null;
      return {
        carrier: f("Delta Air Lines", "Delta Air Lines", 0.97),
        amount: { value: 431, currency: "USD", evidence: "eCredit amount: $431.00", confidence: 0.98 },
        expiration_date: exp ? f(exp.iso, `Travel must be completed by ${exp.evidence}`, 0.95) : none,
        expiration_rule: f("travel_by", "Travel must be completed by", 0.95),
        credit_code: f("0062198473516", "eCredit number: 0062198473516", 0.95),
        issued_date: sent ? f(sent, `Date: ${sent}`, 0.9) : none,
      };
    },
  },
];

