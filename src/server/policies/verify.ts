import type { FetchedPage, PolicyExtraction, PolicyKind, PolicyResult } from "./types";

/**
 * A web answer is accepted only if:
 *  - it cites a page we actually fetched,
 *  - its quote appears verbatim on that page (whitespace/quotes normalized),
 *  - the quote itself states the claimed duration, and
 *  - the duration is plausible for the kind of policy.
 * Anything else is treated as "not found". Same zero-false-deadline rule as documents.
 */

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45,
  sixty: 60, ninety: 90, "one hundred twenty": 120, "a": 1, "an": 1,
};

export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** All durations mentioned in a sentence, in days (for returns) or months (for warranties). */
export function durationsIn(quote: string): { days: number[]; months: number[] } {
  const q = normalizeForMatch(quote);
  const days: number[] = [];
  const months: number[] = [];
  const re = /\b(\d{1,3}|one hundred twenty|forty-five|[a-z]+)[\s-]*(?:\(\d{1,3}\)[\s-]*)?(day|month|year)s?\b/g;
  for (const m of q.matchAll(re)) {
    const raw = m[1]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw];
    if (!n) continue;
    if (m[2] === "day") days.push(n);
    else if (m[2] === "month") {
      months.push(n);
      days.push(n * 30);
    } else {
      months.push(n * 12);
      days.push(n * 365);
    }
  }
  return { days, months };
}

export function verifyExtraction(kind: PolicyKind, x: PolicyExtraction, pages: FetchedPage[]): { ok: true; result: PolicyResult } | { ok: false; reason: string } {
  if (!x.found) return { ok: false, reason: "not_found" };
  if (!x.quote.trim() || x.duration_value == null || !x.duration_unit) return { ok: false, reason: "incomplete" };
  const page = pages.find((p) => sameUrl(p.url, x.source_url));
  if (!page) return { ok: false, reason: "source_not_fetched" };
  const quote = normalizeForMatch(x.quote);
  if (quote.length < 12 || !normalizeForMatch(page.text).includes(quote)) return { ok: false, reason: "quote_not_on_page" };

  // The sentence itself must be about the policy, not just any line with a number on the page.
  const topical = kind === "return" ? /\b(return|returned|returns|refund|exchange)/i : /\b(warrant|guarantee|coverage|covered|covers)/i;
  if (!topical.test(x.quote)) return { ok: false, reason: "quote_off_topic" };

  const found = durationsIn(x.quote);
  if (kind === "return") {
    const d = x.duration_unit === "days" ? x.duration_value : x.duration_unit === "months" ? x.duration_value * 30 : x.duration_value * 365;
    if (d < 1 || d > 365) return { ok: false, reason: "implausible" };
    if (!found.days.includes(d)) return { ok: false, reason: "duration_not_in_quote" };
    return { ok: true, result: build(x, page, d, "days") };
  }
  const months = x.duration_unit === "months" ? x.duration_value : x.duration_unit === "years" ? x.duration_value * 12 : Math.round(x.duration_value / 30);
  if (months < 1 || months > 240) return { ok: false, reason: "implausible" };
  if (!found.months.includes(months)) return { ok: false, reason: "duration_not_in_quote" };
  return { ok: true, result: build(x, page, months, "months") };
}

function build(x: PolicyExtraction, page: FetchedPage, value: number, unit: "days" | "months"): PolicyResult {
  const clip = (s: string | null) => (s ? s.trim().slice(0, 140) || null : null);
  return {
    value,
    unit,
    startsFrom: x.starts_from,
    quote: x.quote.trim().slice(0, 400),
    sourceUrl: page.url,
    sourceTitle: page.title,
    categoryNote: clip(x.category_note),
    membershipNote: clip(x.membership_note),
    coverageNote: clip(x.coverage_note),
  };
}

function sameUrl(a: string, b: string) {
  const n = (u: string) => u.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
  return !!a && !!b && n(a) === n(b);
}
