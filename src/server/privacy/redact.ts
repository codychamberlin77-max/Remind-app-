/**
 * Data minimization before any external AI call. We remove things the model
 * does not need to find a deadline: full card numbers, SSNs, IBANs, and the
 * user's own name/email. Grounding later checks evidence against THIS text.
 */

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export type RedactionReport = { cards: number; ssns: number; ibans: number; identity: number };

export function redact(
  text: string,
  identity: { name?: string | null; email?: string | null } = {},
): { text: string; report: RedactionReport } {
  const report: RedactionReport = { cards: 0, ssns: 0, ibans: 0, identity: 0 };

  let out = text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m;
    report.cards++;
    return `•••• ${digits.slice(-4)}`;
  });

  out = out.replace(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, () => {
    report.ssns++;
    return "[redacted-ssn]";
  });

  out = out.replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, () => {
    report.ibans++;
    return "[redacted-iban]";
  });

  if (identity.email) {
    const re = new RegExp(escapeRe(identity.email), "gi");
    out = out.replace(re, () => {
      report.identity++;
      return "[your email]";
    });
  }
  if (identity.name && identity.name.trim().length >= 3) {
    const re = new RegExp(`\\b${escapeRe(identity.name.trim())}\\b`, "gi");
    out = out.replace(re, () => {
      report.identity++;
      return "[your name]";
    });
  }
  return { text: out, report };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
