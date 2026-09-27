import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { audit } from "@/server/audit/log";
import { db, schema, withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { readHeaders, type EmailHeaders } from "@/server/ingestion/emailHeaders";
import { FORWARD_THRESHOLD, scoreEmail } from "@/server/ingestion/emailRelevance";
import { ingest } from "@/server/ingestion/ingest";
import { sha256Hex } from "@/server/privacy/crypto";

/**
 * Email forwarding: every user gets a private address. Mail sent to it (by hand
 * or via a Gmail/Outlook rule) flows through the same ingest() pipeline as uploads.
 */

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/o/0/1 look-alikes
const DAILY_LIMIT = 300;

export function inboundDomain(): string | null {
  return env().INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null;
}

function newToken(): string {
  const bytes = randomBytes(12);
  let t = "";
  for (const b of bytes) t += ALPHABET[b % ALPHABET.length];
  return t; // ~60 bits: not guessable, easy to read aloud
}

export function addressFor(token: string): string | null {
  const d = inboundDomain();
  return d ? `${token}@${d}` : null;
}

export async function getOrCreateAddress(userId: string) {
  return withUser(userId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.inboundAddresses)
      .where(and(eq(schema.inboundAddresses.userId, userId), isNull(schema.inboundAddresses.disabledAt)))
      .orderBy(desc(schema.inboundAddresses.createdAt))
      .limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(schema.inboundAddresses).values({ userId, token: newToken() }).returning();
    await audit(tx, { userId, event: "inbound.address_created" });
    return created!;
  });
}

/** Replace the address (e.g. if it leaked). The old one stops accepting mail immediately. */
export async function regenerateAddress(userId: string) {
  await withUser(userId, async (tx) => {
    await tx
      .update(schema.inboundAddresses)
      .set({ disabledAt: new Date() })
      .where(and(eq(schema.inboundAddresses.userId, userId), isNull(schema.inboundAddresses.disabledAt)));
    await tx.insert(schema.inboundAddresses).values({ userId, token: newToken() });
    await audit(tx, { userId, event: "inbound.address_regenerated" });
  });
}

export async function getForwardingStatus(userId: string) {
  const address = await getOrCreateAddress(userId);
  const activity = await withUser(userId, (tx) =>
    tx
      .select({
        id: schema.inboundMessages.id,
        status: schema.inboundMessages.status,
        fromDomain: schema.inboundMessages.fromDomain,
        reason: schema.inboundMessages.relevanceReason,
        createdAt: schema.inboundMessages.createdAt,
        documentId: schema.inboundMessages.documentId,
        documentName: schema.documents.originalFilename,
        documentStatus: schema.documents.status,
      })
      .from(schema.inboundMessages)
      .leftJoin(schema.documents, eq(schema.documents.id, schema.inboundMessages.documentId))
      .where(eq(schema.inboundMessages.userId, userId))
      .orderBy(desc(schema.inboundMessages.createdAt))
      .limit(20),
  );
  return {
    enabled: !!inboundDomain(),
    address: addressFor(address.token),
    verification:
      address.verificationCode || address.verificationLink
        ? { code: address.verificationCode, link: address.verificationLink, receivedAt: address.verificationReceivedAt }
        : null,
    lastReceivedAt: address.lastReceivedAt,
    activity,
  };
}

// ───────────────────────────── Receiving mail ─────────────────────────────

export type InboundResult =
  | { status: "unknown_recipient" }
  | { status: "verification" }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "ingested"; documentId: string; attachments: number };

/** `abc123@in.example.com` or `abc123+anything@…` → `abc123` */
export function tokenFromRecipient(to: string): string | null {
  const m = /^\s*(?:.*<)?([a-z0-9]{6,40})(?:\+[^@]*)?@/i.exec(to);
  return m ? m[1]!.toLowerCase() : null;
}

function isGmailForwardingConfirmation(h: EmailHeaders): boolean {
  return /forwarding-noreply@google\.com/i.test(h.from) && /forwarding confirmation/i.test(h.subject);
}

async function captureGmailVerification(userId: string, token: string, raw: Buffer, h: EmailHeaders) {
  const mail = await simpleParser(raw, { skipImageLinks: true });
  const text = `${h.subject}\n${mail.text ?? ""}`;
  const code = /\(#(\d{6,12})\)/.exec(h.subject)?.[1] ?? /confirmation code:\s*(\d{6,12})/i.exec(text)?.[1] ?? null;
  const link = /(https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"<>)]+)/i.exec(text)?.[1] ?? null;
  await withUser(userId, async (tx) => {
    await tx
      .update(schema.inboundAddresses)
      .set({ verificationCode: code, verificationLink: link, verificationReceivedAt: new Date(), lastReceivedAt: new Date() })
      .where(and(eq(schema.inboundAddresses.userId, userId), eq(schema.inboundAddresses.token, token)));
    await tx
      .insert(schema.inboundMessages)
      .values({ userId, providerMessageId: h.messageId ?? sha256Hex(raw), relevanceScore: 0, relevanceReason: "gmail_verification", fromDomain: "google.com", status: "verification" })
      .onConflictDoNothing();
    await audit(tx, { userId, actor: "system", event: "inbound.gmail_verification" });
  });
}

/**
 * Handle one delivered message. Called by the signed webhook from the mail relay.
 * The raw message is never logged; skipped mail keeps only an id, domain and score.
 */
export async function receiveInboundEmail(input: { to: string; raw: Buffer }): Promise<InboundResult> {
  const token = tokenFromRecipient(input.to);
  if (!token) return { status: "unknown_recipient" };
  const found = await db().execute<{ user_id: string | null }>(sql`select app_inbound_user(${token}) as user_id`);
  const userId = found.rows[0]?.user_id;
  if (!userId) return { status: "unknown_recipient" };

  const h = readHeaders(input.raw.toString("latin1"));
  if (isGmailForwardingConfirmation(h)) {
    await captureGmailVerification(userId, token, input.raw, h);
    return { status: "verification" };
  }

  const providerMessageId = h.messageId ?? `sha256:${sha256Hex(input.raw)}`;
  const pre = await withUser(userId, async (tx) => {
    const [seen] = await tx
      .select({ id: schema.inboundMessages.id })
      .from(schema.inboundMessages)
      .where(and(eq(schema.inboundMessages.userId, userId), eq(schema.inboundMessages.providerMessageId, providerMessageId)));
    if (seen) return "duplicate" as const;
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.inboundMessages)
      .where(and(eq(schema.inboundMessages.userId, userId), gte(schema.inboundMessages.createdAt, new Date(Date.now() - 86_400_000))));
    if ((recent?.n ?? 0) >= DAILY_LIMIT) return "limited" as const;
    await tx
      .update(schema.inboundAddresses)
      .set({ lastReceivedAt: new Date() })
      .where(and(eq(schema.inboundAddresses.userId, userId), eq(schema.inboundAddresses.token, token)));
    return "ok" as const;
  });
  if (pre === "duplicate") return { status: "duplicate" };

  const record = (status: "skipped" | "ingested" | "rejected", score: number, reason: string, documentId: string | null = null) =>
    withUser(userId, async (tx) => {
      await tx
        .insert(schema.inboundMessages)
        .values({ userId, providerMessageId, relevanceScore: score, relevanceReason: reason, fromDomain: h.fromDomain, status, documentId })
        .onConflictDoNothing();
      await audit(tx, { userId, actor: "system", event: `inbound.${status}`, metadata: { fromDomain: h.fromDomain, score } });
    });

  if (pre === "limited") {
    await record("rejected", 0, "daily_limit");
    return { status: "rejected", reason: "daily_limit" };
  }

  const rel = scoreEmail(h, input.raw.subarray(0, 40_000).toString("latin1"));
  if (rel.score < FORWARD_THRESHOLD) {
    await record("skipped", rel.score, rel.reasons.join(","));
    return { status: "skipped", reason: rel.reasons.join(",") };
  }

  const [user] = await db().select({ plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, userId));
  const subject = h.subject.replace(/^(fwd?|fw):\s*/i, "").slice(0, 100) || "Email";
  const res = await ingest({ userId, plan: user?.plan, source: "email_forward", bytes: input.raw, filename: `${subject}.eml`, sourceRef: h.messageId ?? undefined });
  if (res.status === "rejected") {
    await record("rejected", rel.score, res.code);
    return { status: "rejected", reason: res.code };
  }
  await record("ingested", rel.score, rel.reasons.join(",") || "forwarded", res.documentId);

  // Photos of receipts attached to an email become their own documents.
  let attachments = 0;
  if (/image\/(jpe?g|png|webp)/i.test(input.raw.subarray(0, 2_000_000).toString("latin1"))) {
    const mail = await simpleParser(input.raw, { skipImageLinks: true });
    for (const att of mail.attachments ?? []) {
      if (!/^image\/(jpe?g|png|webp)$/i.test(att.contentType) || att.size < 30_000 || att.related) continue;
      const r = await ingest({ userId, plan: user?.plan, source: "email_forward", bytes: att.content, filename: att.filename ?? `${subject}.jpg`, sourceRef: h.messageId ?? undefined });
      if (r.status === "accepted") attachments++;
      if (attachments >= 5) break;
    }
  }
  return { status: "ingested", documentId: res.documentId, attachments };
}
