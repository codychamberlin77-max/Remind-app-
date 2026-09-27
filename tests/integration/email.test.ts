import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as inboundPost } from "@/app/api/inbound/email/route";
import { signInbound } from "@/server/http/inboundSignature";
import { claimStuckImports, listImports, runImport, startImport } from "@/server/services/emailImport";
import { getForwardingStatus, getOrCreateAddress, receiveInboundEmail, regenerateAddress } from "@/server/services/inbound";
import { objectStore } from "@/server/storage/objectStore";
import { adminPool, createUser, resetDb } from "../helpers/db";

const SECRET = "test-inbound-secret-0123456789abcdef";
const DOMAIN = "in.lifeos.test";

function eml(opts: { from: string; subject: string; id: string; date?: string; body?: string; extra?: Record<string, string> }) {
  const h = {
    From: opts.from,
    To: "me@gmail.com",
    Subject: opts.subject,
    Date: opts.date ?? new Date(Date.now() - 13 * 86_400_000).toUTCString(),
    "Message-ID": `<${opts.id}@mail.example>`,
    "Content-Type": "text/plain; charset=utf-8",
    ...opts.extra,
  };
  return Buffer.from(
    Object.entries(h)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n") + `\r\n\r\n${opts.body ?? "Thanks for your order."}\r\n`,
  );
}

const receipt = (id: string, date?: string) =>
  eml({ from: "Best Buy <BestBuyInfo@emailinfo.bestbuy.com>", subject: `Your Best Buy order #BBY01-${id}`, id, date, body: "Thanks for your order.\r\nSamsung 65\" TV\r\nOrder total: $1,299.99\r\nPurchased September 14, 2026." });
const promo = (id: string) =>
  eml({ from: "Deals <news@store.example>", subject: "Flash sale: 40% off everything this weekend", id, extra: { "List-Unsubscribe": "<mailto:u@store.example>", Precedence: "bulk" }, body: "Shop now. Unsubscribe." });

/** Test inspection bypasses RLS via the admin connection. */
async function docsOf(userId: string) {
  const { rows } = await adminPool().query<{ source: string }>(`select source from documents where user_id = $1`, [userId]);
  return rows;
}

async function addressOf(userId: string) {
  const a = await getOrCreateAddress(userId);
  return `${a.token}@${DOMAIN}`;
}

describe("email forwarding", () => {
  beforeEach(resetDb);

  it("gives each user a stable private address and can replace it", async () => {
    const u = await createUser();
    const a1 = await addressOf(u.id);
    expect(a1).toMatch(/^[a-z2-9]{12}@in\.lifeos\.test$/);
    expect(await addressOf(u.id)).toBe(a1);
    await regenerateAddress(u.id);
    const a2 = await addressOf(u.id);
    expect(a2).not.toBe(a1);
    // The old address stops working.
    expect((await receiveInboundEmail({ to: a1, raw: receipt("old") })).status).toBe("unknown_recipient");
  });

  it("ingests a forwarded receipt, dedupes a re-send, and skips social mail", async () => {
    const u = await createUser();
    const to = await addressOf(u.id);
    const r = await receiveInboundEmail({ to, raw: receipt("1001") });
    expect(r.status).toBe("ingested");
    expect((await receiveInboundEmail({ to, raw: receipt("1001") })).status).toBe("duplicate");

    const social = eml({ from: "LinkedIn <notifications@linkedin.com>", subject: "You appeared in 9 searches this week", id: "li1", extra: { "List-Unsubscribe": "<mailto:x@linkedin.com>" } });
    expect((await receiveInboundEmail({ to, raw: social })).status).toBe("skipped");

    const status = await getForwardingStatus(u.id);
    expect(status.enabled).toBe(true);
    expect(status.activity.map((a) => a.status).sort()).toEqual(["ingested", "skipped"]);
    expect(status.lastReceivedAt).not.toBeNull();
    const docs = await docsOf(u.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.source).toBe("email_forward");
  });

  it("captures the Gmail forwarding confirmation code instead of treating it as a document", async () => {
    const u = await createUser();
    const to = await addressOf(u.id);
    const raw = eml({
      from: "Gmail Team <forwarding-noreply@google.com>",
      subject: "(#482913570) Gmail Forwarding Confirmation - Receive Mail from me@gmail.com",
      id: "gfc",
      body: "me@gmail.com has requested to automatically forward mail to your email address.\r\nConfirmation code: 482913570\r\n\r\nTo allow, click the link below:\r\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ9%5D-abc\r\n",
    });
    expect((await receiveInboundEmail({ to, raw })).status).toBe("verification");
    const s = await getForwardingStatus(u.id);
    expect(s.verification?.code).toBe("482913570");
    expect(s.verification?.link).toMatch(/^https:\/\/mail-settings\.google\.com\/mail\//);
    expect(await docsOf(u.id)).toHaveLength(0);
  });

  it("never delivers one user's mail to another", async () => {
    const a = await createUser();
    const b = await createUser();
    const toA = await addressOf(a.id);
    await addressOf(b.id);
    await receiveInboundEmail({ to: toA, raw: receipt("2001") });
    expect(await docsOf(b.id)).toHaveLength(0);
    expect((await getForwardingStatus(b.id)).activity).toHaveLength(0);
    expect((await receiveInboundEmail({ to: `zzzzzzzzzzzz@${DOMAIN}`, raw: receipt("2002") })).status).toBe("unknown_recipient");
  });
});

describe("inbound webhook", () => {
  beforeEach(resetDb);

  function request(to: string, raw: Buffer, opts: { secret?: string; ts?: number } = {}) {
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    return new Request("http://localhost/api/inbound/email", {
      method: "POST",
      headers: { "x-lifeos-timestamp": ts, "x-lifeos-to": to, "x-lifeos-signature": signInbound(opts.secret ?? SECRET, ts, to, raw), "content-type": "message/rfc822" },
      body: new Uint8Array(raw),
    });
  }

  it("accepts signed mail and rejects forged, replayed and unknown-recipient mail", async () => {
    const u = await createUser();
    const to = await addressOf(u.id);
    expect((await inboundPost(request(to, receipt("3001")))).status).toBe(200);
    expect((await inboundPost(request(to, receipt("3002"), { secret: "x".repeat(40) }))).status).toBe(401);
    expect((await inboundPost(request(to, receipt("3003"), { ts: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    expect((await inboundPost(request(`zzzzzzzzzzzz@${DOMAIN}`, receipt("3004")))).status).toBe(404);
    expect(await docsOf(u.id)).toHaveLength(1);
  });
});

// ─── Takeout import ───

function mbox(messages: Buffer[]) {
  return Buffer.from(
    messages.map((m, i) => `From 17900000${i}@xxx Mon Sep 14 10:00:00 +0000 2026\n${m.toString("latin1").replace(/\r\n/g, "\n").replace(/^From /gm, ">From ")}\n`).join("\n"),
    "latin1",
  );
}

/** Minimal store-only zip (enough for yauzl) so the test has no extra dependency. */
function zipOf(files: Record<string, Buffer>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function olmMessage(subject: string, daysAgo: number) {
  const sent = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<emails><email>
  <OPFMessageCopySubject>${subject}</OPFMessageCopySubject>
  <OPFMessageCopySenderAddress><emailAddress OPFContactEmailAddressAddress="BestBuyInfo@emailinfo.bestbuy.com" OPFContactEmailAddressName="Best Buy" /></OPFMessageCopySenderAddress>
  <OPFMessageCopySentTime>${sent}</OPFMessageCopySentTime>
  <OPFMessageCopyMessageID>&lt;olm-${subject.length}@bestbuy.com&gt;</OPFMessageCopyMessageID>
  <OPFMessageCopyHTMLBody>&lt;html&gt;&lt;body&gt;&lt;p&gt;Thanks for your order.&lt;/p&gt;&lt;p&gt;Order total: $1,299.99&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;</OPFMessageCopyHTMLBody>
</email></emails>`);
}

const webStream = (buf: Buffer) => Readable.toWeb(Readable.from([buf])) as unknown as ReadableStream<Uint8Array>;

describe("Google Takeout import", () => {
  beforeEach(resetDb);

  const messages = () => [
    receipt("4001"),
    promo("p1"),
    receipt("4002"),
    receipt("4003", new Date(Date.now() - 6 * 365 * 86_400_000).toUTCString()), // too old to matter
    eml({ from: "Friend <pal@gmail.com>", subject: "lunch?", id: "f1", body: "From what I heard, noon works." }),
  ];

  async function waitDone(userId: string) {
    const [imp] = await listImports(userId);
    return imp!;
  }

  it("scans an .mbox, imports only relevant recent mail, and deletes the archive", async () => {
    const u = await createUser();
    const file = mbox(messages());
    const row = await startImport(u.id, { filename: "All mail Including Spam and Trash.mbox", body: webStream(file), declaredBytes: file.length });
    // JOBS_MODE=inline ran the scan during enqueue; run again to prove it's idempotent.
    await runImport(u.id, row.id);
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("done");
    expect(imp.scanned).toBe(5);
    expect(imp.imported + imp.duplicates).toBe(2);
    const docs = await docsOf(u.id);
    expect(docs.every((d) => d.source === "email_import")).toBe(true);
    // Privacy: the uploaded mailbox is gone.
    const { rows } = await adminPool().query(`select storage_key from email_imports where id = $1`, [row.id]);
    expect(rows[0].storage_key).toBeNull();
    await expect(objectStore().get(row.storageKey!)).rejects.toThrow();
  });

  it("reads the .zip Takeout produces", async () => {
    const u = await createUser();
    const file = zipOf({ "Takeout/archive_browser.html": Buffer.from("<html></html>"), "Takeout/Mail/All mail Including Spam and Trash.mbox": mbox(messages()) });
    await startImport(u.id, { filename: "takeout-20260927.zip", body: webStream(file), declaredBytes: file.length });
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("done");
    expect(imp.scanned).toBe(5);
  });

  it("reads an Apple Mail export (zipped Inbox.mbox folder)", async () => {
    const u = await createUser();
    const file = zipOf({ "Inbox.mbox/mbox": mbox(messages()), "Inbox.mbox/table_of_contents": Buffer.from([0, 1, 2, 3]), "__MACOSX/Inbox.mbox/._mbox": Buffer.from("junk") });
    await startImport(u.id, { filename: "Inbox.mbox.zip", body: webStream(file), declaredBytes: file.length });
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("done");
    expect(imp.scanned).toBe(5);
    expect(imp.imported + imp.duplicates).toBe(2);
  });

  it("reads a Thunderbird mail file (no extension)", async () => {
    const u = await createUser();
    const file = mbox(messages()).toString("latin1").replace(/^From \S+ /gm, "From - ");
    await startImport(u.id, { filename: "INBOX", body: webStream(Buffer.from(file, "latin1")), declaredBytes: file.length });
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("done");
    expect(imp.scanned).toBe(5);
  });

  it("reads an Outlook .pst", async () => {
    const u = await createUser();
    // Real Outlook file shipped with pst-extractor (2001-era Enron mail).
    const file = readFileSync("node_modules/pst-extractor/example/testdata/enron.pst");
    await startImport(u.id, { filename: "backup.pst", body: webStream(file), declaredBytes: file.length });
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("done");
    expect(imp.scanned).toBe(71);
    expect(imp.imported).toBe(0); // all far too old to have open deadlines
  });

  it("reads an Outlook for Mac .olm", async () => {
    const u = await createUser();
    const file = zipOf({
      "Accounts/me@outlook.com/com.microsoft.__Messages/Inbox/message_00001.xml": olmMessage("Your Best Buy order #BBY01-9001", 5),
      "Accounts/me@outlook.com/com.microsoft.__Messages/Inbox/message_00002.xml": olmMessage("Your Best Buy order #BBY01-9002 has shipped", 8),
      "Accounts/me@outlook.com/Categories.xml": Buffer.from("<categories/>"),
    });
    await startImport(u.id, { filename: "Outlook for Mac Archive.olm", body: webStream(file), declaredBytes: file.length });
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("done");
    expect(imp.scanned).toBe(2);
    expect(imp.imported).toBe(2);
  });

  it("rejects the wrong file type, reports a file with no email, and allows one import at a time", async () => {
    const u = await createUser();
    await expect(startImport(u.id, { filename: "photo.jpg", body: webStream(Buffer.from("x")), declaredBytes: 1 })).rejects.toThrow(/mbox/);
    await startImport(u.id, { filename: "empty.mbox", body: webStream(Buffer.from("not an mbox at all\n")), declaredBytes: 19 });
    const imp = await waitDone(u.id);
    expect(imp.status).toBe("failed");
    expect(imp.failureReason).toMatch(/couldn't find any emails/);

    await adminPool().query(`insert into email_imports (id, user_id, filename, size_bytes, status) values (gen_random_uuid(), $1, 'x.mbox', 1, 'scanning')`, [u.id]);
    await expect(startImport(u.id, { filename: "b.mbox", body: webStream(Buffer.from("x")), declaredBytes: 1 })).rejects.toThrow(/already running/);
  });

  it("only claims imports that have waited with no worker", async () => {
    const u = await createUser();
    await adminPool().query(`insert into email_imports (id, user_id, filename, size_bytes, status, created_at) values (gen_random_uuid(), $1, 'new.mbox', 1, 'queued', now())`, [u.id]);
    expect(await claimStuckImports(u.id)).toHaveLength(0);
    await adminPool().query(`update email_imports set created_at = now() - interval '1 minute'`);
    expect(await claimStuckImports(u.id)).toHaveLength(1);
    expect(await claimStuckImports(u.id)).toHaveLength(0); // claimed exactly once
  });
});
