/**
 * Deterministic date handling. The model proposes an ISO date plus the verbatim
 * text it read it from; this module independently parses that text and decides
 * whether the proposal is supported, ambiguous, or unsupported.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

export type DateOrder = "MDY" | "DMY";

export type DateCandidate = {
  iso: string;
  /** How the date was written. */
  form: "iso" | "month_name" | "numeric" | "weekday" | "relative";
  /** Year was absent in the text and had to be inferred from context. */
  yearInferred: boolean;
  /** Numeric date where day/month order could not be resolved. */
  ambiguousWith?: string;
};

export function isValidIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toIso(y: number, m: number, d: number): string | null {
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIso(iso) ? iso : null;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIsoStr: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIsoStr}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** "Today" as a calendar date in the user's timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/**
 * Detect the numeric date order a document uses, from dates whose order is
 * self-evident (one component > 12) and from currency hints.
 */
export function detectDateOrder(text: string): DateOrder | null {
  let mdy = 0;
  let dmy = 0;
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (mdy && !dmy) return "MDY";
  if (dmy && !mdy) return "DMY";
  return null;
}

/**
 * Parse every date expression in `text`. `referenceIso` is used to infer
 * missing years and resolve weekdays ("renews Friday").
 */
export function parseDates(text: string, opts: { referenceIso?: string | null; order?: DateOrder | null } = {}): DateCandidate[] {
  const out: DateCandidate[] = [];
  const s = text.replace(/ /g, " ");
  const ref = opts.referenceIso ?? null;
  const refYear = ref ? Number(ref.slice(0, 4)) : null;

  // ISO: 2026-09-10
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) out.push({ iso, form: "iso", yearInferred: false });
  }

  const monthRe = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  // Month-name first: "September 10, 2026", "Sep 10 2026", "Sept. 10"
  for (const m of s.matchAll(new RegExp(`\\b${monthRe}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi"))) {
    const month = MONTHS[m[1]!.toLowerCase().replace(".", "")];
    const day = Number(m[2]);
    if (!month) continue;
    pushNamed(out, month, day, m[3] ? Number(m[3]) : null, ref, refYear);
  }
  // Day first: "10 September 2026", "10 Sep"
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthRe}(?:,?\\s+(\\d{4}))?\\b`, "gi"))) {
    const month = MONTHS[m[2]!.toLowerCase().replace(".", "")];
    const day = Number(m[1]);
    if (!month) continue;
    pushNamed(out, month, day, m[3] ? Number(m[3]) : null, ref, refYear);
  }

  // Numeric: 09/10/2026, 9/10/26, 10.09.2026
  for (const m of s.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(Number(m[3]));
    const mdy = toIso(y, a, b);
    const dmy = toIso(y, b, a);
    if (mdy && dmy && a !== b) {
      if (opts.order === "MDY") out.push({ iso: mdy, form: "numeric", yearInferred: false });
      else if (opts.order === "DMY") out.push({ iso: dmy, form: "numeric", yearInferred: false });
      else {
        out.push({ iso: mdy, form: "numeric", yearInferred: false, ambiguousWith: dmy });
        out.push({ iso: dmy, form: "numeric", yearInferred: false, ambiguousWith: mdy });
      }
    } else if (mdy) out.push({ iso: mdy, form: "numeric", yearInferred: false });
    else if (dmy) out.push({ iso: dmy, form: "numeric", yearInferred: false });
  }

  if (ref) {
    // Weekday-only expressions resolve to the next such day on/after the reference date.
    for (const m of s.matchAll(/\b(?:this\s+|next\s+|on\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b(?!\s*,?\s*(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi)) {
      const wd = WEEKDAYS[m[1]!.toLowerCase()];
      if (wd === undefined) continue;
      const delta = (wd - weekdayOf(ref) + 7) % 7;
      out.push({ iso: addDays(ref, delta), form: "weekday", yearInferred: true });
      if (delta === 0) out.push({ iso: addDays(ref, 7), form: "weekday", yearInferred: true });
    }
    if (/\btomorrow\b/i.test(s)) out.push({ iso: addDays(ref, 1), form: "relative", yearInferred: true });
    if (/\btoday\b/i.test(s)) out.push({ iso: ref, form: "relative", yearInferred: true });
    const inDays = /\bin\s+(\d{1,3})\s+days?\b/i.exec(s);
    if (inDays) out.push({ iso: addDays(ref, Number(inDays[1])), form: "relative", yearInferred: true });
  }
  return out;
}

function pushNamed(out: DateCandidate[], month: number, day: number, year: number | null, ref: string | null, refYear: number | null) {
  if (year) {
    const iso = toIso(year, month, day);
    if (iso) out.push({ iso, form: "month_name", yearInferred: false });
    return;
  }
  if (!refYear) return;
  // Year omitted: allow the reference year and its neighbours; the claimed value picks one.
  for (const y of [refYear, refYear + 1, refYear - 1]) {
    const iso = toIso(y, month, day);
    if (iso) out.push({ iso, form: "month_name", yearInferred: true });
  }
}

export type DateCheck =
  | { status: "supported"; candidate: DateCandidate }
  | { status: "ambiguous"; candidate: DateCandidate; alternative: string }
  | { status: "unsupported"; reason: string };

/** Does the quoted evidence actually say the date the model claims? */
export function checkDateAgainstEvidence(
  claimedIso: string,
  evidence: string,
  opts: { referenceIso?: string | null; order?: DateOrder | null },
): DateCheck {
  if (!isValidIso(claimedIso)) return { status: "unsupported", reason: "invalid date" };
  const cands = parseDates(evidence, opts).filter((c) => c.iso === claimedIso);
  if (!cands.length) return { status: "unsupported", reason: "evidence does not contain this date" };
  const exact = cands.find((c) => !c.ambiguousWith);
  if (exact) return { status: "supported", candidate: exact };
  const amb = cands[0]!;
  return { status: "ambiguous", candidate: amb, alternative: amb.ambiguousWith! };
}

export function formatDate(iso: string, opts: { withYear?: boolean } = {}): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.withYear === false ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}
