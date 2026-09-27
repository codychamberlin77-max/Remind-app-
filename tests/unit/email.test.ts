import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { signInbound, verifyInbound } from "@/server/http/inboundSignature";
import { domainOf, readHeaders } from "@/server/ingestion/emailHeaders";
import { FORWARD_THRESHOLD, IMPORT_THRESHOLD, scoreEmail } from "@/server/ingestion/emailRelevance";
import { olmToRaw } from "@/server/ingestion/mailArchive";
import { splitMbox } from "@/server/ingestion/mbox";
import { isAcceptedArchiveName } from "@/lib/mailArchiveNames";
import { normalizeEmail, parseForwardedHeader } from "@/server/ingestion/normalize";
import { tokenFromRecipient } from "@/server/services/inbound";

const mail = (headers: Record<string, string>, body = "Hello") =>
  Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n") + `\r\n\r\n${body}`;

const score = (headers: Record<string, string>, body = "") => scoreEmail(readHeaders(mail(headers, body)), body).score;

describe("email headers", () => {
  it("collapses subdomains and decodes encoded subjects", () => {
    expect(domainOf("Amazon <auto-confirm@amazon.com>")).toBe("amazon.com");
    expect(domainOf("x@t.delta.com")).toBe("delta.com");
    expect(domainOf("x@shop.example.co.uk")).toBe("example.co.uk");
    const h = readHeaders(mail({ From: "Store <a@b.com>", Subject: "=?UTF-8?B?WW91ciBvcmRlciDinJM=?=" }));
    expect(h.subject).toBe("Your order ✓");
  });
});

describe("relevance filter", () => {
  it("keeps receipts, trials, credits and warranties", () => {
    expect(score({ From: "Amazon.com <auto-confirm@amazon.com>", Subject: "Your Amazon.com order #112-445 has shipped" }, "Order total: $54.20")).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
    expect(score({ From: "StreamMax <billing@streammax.example>", Subject: "Your free trial ends Friday" })).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
    expect(score({ From: "Delta <x@t.delta.com>", Subject: "Your eCredit is ready" })).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
    expect(score({ From: "Shop <x@shop.example>", Subject: "Receipt for your purchase" }, "Total $19.99")).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
  });
  it("drops marketing and social mail", () => {
    expect(score({ From: "Deals <news@store.example>", Subject: "48-hour flash sale: 40% off everything", "List-Unsubscribe": "<mailto:u@x>" })).toBeLessThan(IMPORT_THRESHOLD);
    expect(score({ From: "LinkedIn <notifications@linkedin.com>", Subject: "You appeared in 5 searches" })).toBeLessThan(FORWARD_THRESHOLD);
    expect(score({ From: "Friend <pal@gmail.com>", Subject: "lunch?" })).toBeLessThan(IMPORT_THRESHOLD);
  });
  it("does not penalize a receipt just because it has List-Unsubscribe", () => {
    expect(score({ From: "Best Buy <x@emailinfo.bestbuy.com>", Subject: "Thanks for your order", "List-Unsubscribe": "<mailto:u@x>" })).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
  });
});

describe("forwarded emails", () => {
  const gmailFwd = [
    "---------- Forwarded message ---------",
    "From: Best Buy <BestBuyInfo@emailinfo.bestbuy.com>",
    "Date: Mon, Sep 14, 2026 at 3:12 PM",
    "Subject: Your Best Buy order #BBY01-8061",
    "To: <me@gmail.com>",
    "",
    "Thanks for your order. Total $1,299.99",
  ].join("\n");

  it("reads the original sender, subject and date", () => {
    expect(parseForwardedHeader(gmailFwd)).toEqual({ from: "Best Buy <BestBuyInfo@emailinfo.bestbuy.com>", subject: "Your Best Buy order #BBY01-8061", dateIso: "2026-09-14" });
    const outlook = "From: Delta <x@delta.com>\nSent: Tuesday, March 3, 2026 9:00 AM\nTo: me\nSubject: eCredit confirmation\n\nbody";
    expect(parseForwardedHeader(`________________________________\n${outlook}`)?.subject).toBe("eCredit confirmation");
    expect(parseForwardedHeader("just a normal email")).toBeNull();
  });

  it("normalizes a forward as the original email (purchase date = original date, not forward date)", async () => {
    const raw = mail({ From: "Me <me@gmail.com>", To: "abc@in.lifeos.test", Subject: "Fwd: Your Best Buy order #BBY01-8061", Date: "Sun, 27 Sep 2026 10:00:00 -0400" }, gmailFwd);
    const doc = await normalizeEmail(Buffer.from(raw));
    expect(doc.meta.emailSubject).toBe("Your Best Buy order #BBY01-8061");
    expect(doc.meta.emailFrom).toMatch(/bestbuy/i);
    expect(doc.meta.emailDate).toBe("2026-09-14");
    expect(doc.text).toMatch(/Date: 2026-09-14/);
  });
});

describe("inbound signature", () => {
  const secret = "s".repeat(32);
  const raw = Buffer.from("Subject: hi\r\n\r\nbody");
  const now = 1_790_000_000;
  const ts = String(now);
  const sig = signInbound(secret, ts, "abc@in.x", raw);

  it("accepts a valid signature", () => {
    expect(verifyInbound(secret, { timestamp: ts, signature: sig, to: "abc@in.x" }, raw, now)).toBe(true);
  });
  it("rejects tampering, wrong recipient, wrong secret and stale timestamps", () => {
    expect(verifyInbound(secret, { timestamp: ts, signature: sig, to: "abc@in.x" }, Buffer.from("Subject: hi\r\n\r\nBODY"), now)).toBe(false);
    expect(verifyInbound(secret, { timestamp: ts, signature: sig, to: "other@in.x" }, raw, now)).toBe(false);
    expect(verifyInbound("t".repeat(32), { timestamp: ts, signature: sig, to: "abc@in.x" }, raw, now)).toBe(false);
    expect(verifyInbound(secret, { timestamp: ts, signature: sig, to: "abc@in.x" }, raw, now + 301)).toBe(false);
    expect(verifyInbound(secret, { timestamp: null, signature: sig, to: "abc@in.x" }, raw, now)).toBe(false);
    expect(verifyInbound(secret, { timestamp: ts, signature: "zz", to: "abc@in.x" }, raw, now)).toBe(false);
  });
});

describe("recipient token", () => {
  it("parses plain, plus-tagged and display-name recipients", () => {
    expect(tokenFromRecipient("k7m2p9x4q8rt@in.lifeos.test")).toBe("k7m2p9x4q8rt");
    expect(tokenFromRecipient("K7M2P9X4Q8RT+gmail@in.lifeos.test")).toBe("k7m2p9x4q8rt");
    expect(tokenFromRecipient("LIFEOS <k7m2p9x4q8rt@in.lifeos.test>")).toBe("k7m2p9x4q8rt");
    expect(tokenFromRecipient("no-at-sign")).toBeNull();
  });
});

describe("mbox splitting", () => {
  it("splits messages, un-escapes >From and flags oversized ones", async () => {
    const mbox = [
      "From 1790000000@xxx Mon Sep 14 10:00:00 +0000 2026",
      "Subject: one",
      "",
      "line",
      ">From the start",
      "",
      "From 1790000001@xxx Mon Sep 14 10:00:00 +0000 2026",
      "Subject: two",
      "",
      "x".repeat(2000),
      "",
      "From 1790000002@xxx Mon Sep 14 10:00:00 +0000 2026",
      "Subject: three",
      "",
      "From me, not a separator",
      "",
    ].join("\n");
    const out = [];
    for await (const m of splitMbox(Readable.from([Buffer.from(mbox)]), 1000)) out.push(m);
    expect(out).toHaveLength(3);
    expect(out[0]!.raw.toString()).toContain("From the start");
    expect(out[0]!.raw.toString()).not.toContain(">From");
    expect(out[1]!.oversized).toBe(true);
    expect(out[2]!.raw.toString()).toContain("From me, not a separator");
  });
});

describe("mail export files", () => {
  it("accepts exports from Gmail, Apple Mail, Thunderbird and Outlook", () => {
    for (const f of ["takeout-2026.zip", "All mail.mbox", "mbox", "INBOX", "Sent", "backup.pst", "me@outlook.com.ost", "Outlook for Mac Archive.olm", "C:\\Users\\me\\Inbox"]) {
      expect(isAcceptedArchiveName(f), f).toBe(true);
    }
    for (const f of ["photo.jpg", "Inbox.msf", "notes.txt", ".hidden", ""]) expect(isAcceptedArchiveName(f), f).toBe(false);
  });

  it("turns an .olm message into a normal email", () => {
    const raw = olmToRaw(
      '<emails><email><OPFMessageCopySubject>Caf&#233; order &amp; receipt</OPFMessageCopySubject><OPFMessageCopySenderAddress><emailAddress OPFContactEmailAddressAddress="a@shop.example" OPFContactEmailAddressName="Shop" /></OPFMessageCopySenderAddress><OPFMessageCopySentTime>2026-09-01T10:00:00</OPFMessageCopySentTime><OPFMessageCopyBody>Total $5</OPFMessageCopyBody></email></emails>',
    )!;
    const h = readHeaders(raw.toString("latin1"));
    expect(h.subject).toBe("Café order & receipt");
    expect(h.fromDomain).toBe("shop.example");
    expect(h.date?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(raw.toString()).toContain("Total $5");
    expect(olmToRaw("<categories/>")).toBeNull();
  });
});
