/**
 * Cheap header parsing for relevance decisions, without a full MIME parse.
 * Used to scan thousands of archived messages quickly.
 */
export type EmailHeaders = {
  from: string;
  fromDomain: string | null;
  subject: string;
  date: Date | null;
  messageId: string | null;
  listUnsubscribe: boolean;
  precedenceBulk: boolean;
  contentType: string;
};

function decodeWords(s: string): string {
  // RFC 2047 encoded-words: =?utf-8?B?...?= / =?utf-8?Q?...?=
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, _cs: string, enc: string, text: string) => {
    try {
      if (enc.toUpperCase() === "B") return Buffer.from(text, "base64").toString("utf8");
      return Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
    } catch {
      return text;
    }
  });
}

export function parseHeaderBlock(raw: string): Record<string, string> {
  const end = raw.search(/\r?\n\r?\n/);
  const block = end >= 0 ? raw.slice(0, end) : raw;
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      out[current] = `${out[current] ?? ""} ${line.trim()}`;
      continue;
    }
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    current = m[1]!.toLowerCase();
    out[current] = out[current] ?? m[2]!;
  }
  return out;
}

export function domainOf(address: string): string | null {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(address);
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  // Collapse mail subdomains: t.delta.com / email.bestbuy.com → delta.com / bestbuy.com
  const parts = host.split(".");
  const twoLevelTlds = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const lastTwo = parts.slice(-2).join(".");
  return twoLevelTlds.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function readHeaders(raw: string): EmailHeaders {
  const h = parseHeaderBlock(raw.slice(0, 64 * 1024));
  const from = decodeWords(h["from"] ?? "");
  const date = h["date"] ? new Date(h["date"]) : null;
  return {
    from,
    fromDomain: domainOf(from),
    subject: decodeWords(h["subject"] ?? "").trim(),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    messageId: h["message-id"]?.trim() || null,
    listUnsubscribe: !!h["list-unsubscribe"],
    precedenceBulk: /bulk|list|junk/i.test(h["precedence"] ?? ""),
    contentType: h["content-type"] ?? "",
  };
}
