/**
 * Curated, versioned knowledge used ONLY when a document is silent. Anything
 * derived from here is labeled "estimated" and explained to the user.
 *
 * Policies change and vary by membership tier, item category and season. We
 * deliberately use the conservative (shorter) window where categories differ,
 * so an estimate errs toward acting early, never late.
 *
 * Review this table regularly; `lastReviewed` is shown in admin tooling later.
 */
export type MerchantPolicy = {
  id: string;
  name: string;
  match: RegExp;
  returnDays: number;
  /** Shorter window for electronics, where the merchant has one. */
  electronicsReturnDays?: number;
  note: string;
  lastReviewed: string;
};

export const MERCHANT_POLICIES: MerchantPolicy[] = [
  {
    id: "best-buy",
    name: "Best Buy",
    match: /\bbest\s*buy\b|\bbestbuy\b/i,
    returnDays: 15,
    note: "Standard return period is 15 days; some memberships allow longer.",
    lastReviewed: "2026-09",
  },
  {
    id: "amazon",
    name: "Amazon",
    match: /\bamazon(\.com)?\b/i,
    returnDays: 30,
    note: "Most items sold by Amazon can be returned within 30 days of delivery.",
    lastReviewed: "2026-09",
  },
  {
    id: "apple",
    name: "Apple",
    match: /\bapple\s*(store|\.com|online store)?\b/i,
    returnDays: 14,
    note: "Apple's standard return period is 14 days.",
    lastReviewed: "2026-09",
  },
  {
    id: "target",
    name: "Target",
    match: /\btarget\b/i,
    returnDays: 90,
    electronicsReturnDays: 30,
    note: "Most items 90 days; electronics and some other categories are shorter.",
    lastReviewed: "2026-09",
  },
  {
    id: "walmart",
    name: "Walmart",
    match: /\bwal-?mart\b/i,
    returnDays: 90,
    electronicsReturnDays: 30,
    note: "Most items 90 days; electronics are typically 30 days.",
    lastReviewed: "2026-09",
  },
  {
    id: "costco",
    name: "Costco",
    match: /\bcostco\b/i,
    returnDays: 90,
    electronicsReturnDays: 90,
    note: "Electronics generally 90 days; most other items have no fixed limit.",
    lastReviewed: "2026-09",
  },
  {
    id: "home-depot",
    name: "The Home Depot",
    match: /\bhome\s*depot\b/i,
    returnDays: 90,
    note: "Most new, unopened items 90 days; some categories are shorter.",
    lastReviewed: "2026-09",
  },
  {
    id: "lowes",
    name: "Lowe's",
    match: /\blowe'?s\b/i,
    returnDays: 90,
    note: "Most items 90 days; some categories are shorter.",
    lastReviewed: "2026-09",
  },
];

export function findMerchantPolicy(merchant: string | null | undefined): MerchantPolicy | null {
  if (!merchant) return null;
  return MERCHANT_POLICIES.find((p) => p.match.test(merchant)) ?? null;
}

const ELECTRONICS = /\b(tv|television|oled|qled|laptop|macbook|iphone|ipad|phone|tablet|headphones?|earbuds|airpods|camera|monitor|console|playstation|xbox|nintendo|speaker|soundbar|smartwatch|watch|drone|computer|pc|router|kindle)\b/i;

export function looksLikeElectronics(names: string[]): boolean {
  return names.some((n) => ELECTRONICS.test(n));
}

/** Standard manufacturer warranties, used only when no warranty is stated. */
export type ManufacturerWarranty = { brand: string; match: RegExp; months: number; note: string };

export const MANUFACTURER_WARRANTIES: ManufacturerWarranty[] = [
  { brand: "Apple", match: /\b(apple|iphone|ipad|macbook|airpods|imac)\b/i, months: 12, note: "Apple's standard one-year limited warranty." },
  { brand: "Samsung", match: /\bsamsung\b/i, months: 12, note: "Samsung's standard one-year limited warranty for most TVs and appliances." },
  { brand: "Sony", match: /\bsony\b/i, months: 12, note: "Sony's standard one-year limited warranty for most electronics." },
  { brand: "LG", match: /\blg\b/i, months: 12, note: "LG's standard one-year limited warranty for most TVs." },
];

export function findManufacturerWarranty(names: string[]): ManufacturerWarranty | null {
  for (const w of MANUFACTURER_WARRANTIES) if (names.some((n) => w.match.test(n))) return w;
  return null;
}
