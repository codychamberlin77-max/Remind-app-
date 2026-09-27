import type { EmailHeaders } from "./emailHeaders";

/**
 * Deterministic, local relevance filter. It decides which emails are worth
 * reading at all, so we never send a whole inbox to an AI provider. Runs on
 * headers plus a short body sample; nothing is stored for skipped messages
 * beyond an id and a score.
 */
export type Relevance = { score: number; reasons: string[]; category: string | null };

const TRANSACTIONAL: Array<[RegExp, string, number]> = [
  [/\b(order|purchase)\b.*\b(confirm|confirmation|receipt|placed|shipped|delivered)\b|\byour (amazon(\.com)? )?order\b/i, "order", 4],
  [/\b(receipt|invoice|payment (received|confirmation)|thanks for your (order|purchase))\b/i, "receipt", 4],
  [/\bfree trial\b|\btrial (ends|is ending|expires)\b/i, "trial", 5],
  [/\b(renew(s|al|ing)?|auto-?renew|membership|subscription)\b/i, "subscription", 3],
  [/\b(e-?credit|travel credit|flight credit|voucher|future travel|trip credit)\b/i, "credit", 5],
  [/\b(refund|return (label|request|window|started)|return(ed)? your)\b/i, "return", 4],
  [/\b(warranty|protection plan|applecare|proof of coverage)\b/i, "warranty", 5],
  [/\b(booking|reservation|itinerary|check-?in|boarding pass)\b/i, "travel", 3],
  [/\b(bill|statement|amount due|payment due|past due|autopay)\b/i, "bill", 3],
  [/\b(appointment|scheduled for|reminder: your visit)\b/i, "appointment", 3],
];

const MARKETING = /\b(sale|% off|deals?|save (up to|big)|newsletter|limited time|shop now|new arrivals|you('ll| might) (love|like)|webinar|exclusive offer|flash sale|last chance|recommended for you)\b/i;
const SOCIAL = /(facebookmail|linkedin|twitter|x\.com|instagram|tiktok|pinterest|reddit|nextdoor|quora|medium)\.com$/i;

/** Senders whose mail is very often worth tracking. Extend freely. */
const KNOWN_SENDERS = new Set([
  "amazon.com", "bestbuy.com", "apple.com", "target.com", "walmart.com", "costco.com", "homedepot.com", "lowes.com",
  "ebay.com", "etsy.com", "wayfair.com", "ikea.com", "nike.com", "samsung.com", "dell.com", "newegg.com", "bhphotovideo.com",
  "delta.com", "united.com", "aa.com", "southwest.com", "jetblue.com", "alaskaair.com", "aircanada.com", "britishairways.com",
  "airbnb.com", "booking.com", "expedia.com", "hotels.com", "marriott.com", "hilton.com", "hyatt.com", "ihg.com",
  "netflix.com", "spotify.com", "hulu.com", "disneyplus.com", "max.com", "paramountplus.com", "peacocktv.com", "youtube.com",
  "adobe.com", "microsoft.com", "dropbox.com", "audible.com", "nytimes.com", "wsj.com", "patreon.com", "duolingo.com",
  "paypal.com", "squareup.com", "stripe.com", "geeksquad.com", "asurion.com", "allstate.com", "geico.com", "progressive.com",
]);

const MONEY = /(\$|€|£|USD|EUR|GBP)\s?\d{1,3}(,\d{3})*(\.\d{2})?/;

export function scoreEmail(h: EmailHeaders, bodySample = ""): Relevance {
  const reasons: string[] = [];
  let score = 0;
  let category: string | null = null;
  const subject = h.subject;
  const text = `${subject}\n${bodySample.slice(0, 20_000)}`;

  for (const [re, cat, pts] of TRANSACTIONAL) {
    if (re.test(subject)) {
      score += pts;
      category ??= cat;
      reasons.push(`subject:${cat}`);
      break;
    }
  }
  if (!category) {
    for (const [re, cat, pts] of TRANSACTIONAL) {
      if (re.test(bodySample.slice(0, 20_000))) {
        score += Math.ceil(pts / 2);
        category = cat;
        reasons.push(`body:${cat}`);
        break;
      }
    }
  }
  if (h.fromDomain && KNOWN_SENDERS.has(h.fromDomain)) {
    score += 2;
    reasons.push("known_sender");
  }
  if (MONEY.test(text)) {
    score += 1;
    reasons.push("amount");
  }
  if (/application\/pdf|\.pdf/i.test(bodySample) || /multipart\/mixed/i.test(h.contentType)) {
    score += 1;
    reasons.push("attachment");
  }
  if (MARKETING.test(subject) && !reasons.some((r) => r.startsWith("subject:"))) {
    score -= 4;
    reasons.push("marketing");
  }
  if ((h.listUnsubscribe || h.precedenceBulk) && !reasons.some((r) => r.startsWith("subject:"))) {
    score -= 2;
    reasons.push("bulk");
  }
  if (h.fromDomain && SOCIAL.test(h.fromDomain)) {
    score -= 5;
    reasons.push("social");
  }
  return { score, reasons, category };
}

/** Threshold for scanning an archive: be selective. */
export const IMPORT_THRESHOLD = 4;
/** Threshold for mail the user forwarded on purpose: only drop obvious noise. */
export const FORWARD_THRESHOLD = -2;
