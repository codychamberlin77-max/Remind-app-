/**
 * Evidence grounding: does the quote the model gave actually appear in the
 * document we sent it? Dates and money use a strict check (whitespace-insensitive
 * substring). Free-text values may use a token-overlap check.
 */

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function squash(s: string): string {
  return normalizeForMatch(s).replace(/\s+/g, "");
}

export type GroundingLevel = "exact" | "fuzzy" | "none";

export class DocumentIndex {
  readonly squashed: string;
  readonly tokens: Set<string>;
  constructor(readonly text: string) {
    this.squashed = squash(text);
    this.tokens = new Set(tokenize(text));
  }

  /** Whitespace-insensitive substring match — required for dates and money. */
  containsStrict(evidence: string | null | undefined): boolean {
    if (!evidence) return false;
    const e = squash(evidence);
    return e.length >= 2 && this.squashed.includes(e);
  }

  ground(evidence: string | null | undefined, opts: { allowFuzzy: boolean }): GroundingLevel {
    if (!evidence || !evidence.trim()) return "none";
    if (this.containsStrict(evidence)) return "exact";
    if (!opts.allowFuzzy) return "none";
    const toks = tokenize(evidence);
    if (toks.length < 2) return "none";
    // Every number in the quote must exist in the document.
    if (toks.some((t) => /\d/.test(t) && !this.tokens.has(t))) return "none";
    const hit = toks.filter((t) => this.tokens.has(t)).length / toks.length;
    return hit >= 0.9 ? "fuzzy" : "none";
  }
}

export function tokenize(s: string): string[] {
  return normalizeForMatch(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does `evidence` contain this amount in any common formatting? */
export function evidenceContainsAmount(evidence: string, amount: number): boolean {
  const e = squash(evidence).replace(/,/g, "");
  const fixed = amount.toFixed(2);
  const variants = new Set([fixed, fixed.replace(/\.00$/, ""), String(amount)]);
  // European decimal comma: 1.299,00 → strip thousands dot, comma → dot
  const eu = squash(evidence).replace(/\.(?=\d{3}\b)/g, "").replace(/,(\d{2})\b/g, ".$1");
  for (const v of variants) {
    const re = new RegExp(`(^|[^0-9.])${v.replace(".", "\\.")}(?![0-9])`);
    if (re.test(e) || re.test(eu)) return true;
  }
  return false;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45,
  sixty: 60, ninety: 90,
};

/** Numbers mentioned in text, including spelled-out ones. */
export function numbersIn(text: string): number[] {
  const n = normalizeForMatch(text);
  const out = [...n.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  for (const [w, v] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(n)) out.push(v);
  }
  return out;
}

/** Evidence supports a count of days/months (e.g. "2-Year Protection" → 24 months). */
export function evidenceSupportsCount(evidence: string, value: number, unit: "days" | "months"): boolean {
  const nums = numbersIn(evidence);
  const n = normalizeForMatch(evidence);
  if (unit === "days") {
    if (nums.includes(value) && /\bdays?\b/.test(n)) return true;
    if (value % 7 === 0 && nums.includes(value / 7) && /\bweeks?\b/.test(n)) return true;
    return false;
  }
  if (nums.includes(value) && /\bmonths?\b|\bmo\b/.test(n)) return true;
  if (value % 12 === 0 && nums.includes(value / 12) && /\b(years?|yrs?)\b/.test(n)) return true;
  return false;
}
