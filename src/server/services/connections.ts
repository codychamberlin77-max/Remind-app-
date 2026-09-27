import { and, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { db, schema, withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { readHeaders } from "@/server/ingestion/emailHeaders";
import { IMPORT_THRESHOLD, scoreEmail } from "@/server/ingestion/emailRelevance";
import { ingest } from "@/server/ingestion/ingest";
import { mailProvider, ProviderError, type MailProviderId, type TokenSet } from "@/server/mail/providers";
import { decryptField, encryptField } from "@/server/privacy/crypto";
import { NotFoundError } from "./documents";
import { InputError } from "./items";

/**
 * "Connect Gmail / Outlook": read-only access, synced in the background.
 *
 * Privacy:
 *  - tokens are encrypted at rest and never logged;
 *  - we only download messages whose subject looks like a receipt/order/trial/bill,
 *    then the local relevance filter decides; everything else is never fetched;
 *  - skipped mail keeps only an id and a score; disconnecting revokes and deletes the tokens.
 */

const PER_SYNC_FETCH = 60;
const PER_SYNC_IMPORT = 40;

export function redirectUri(provider: MailProviderId) {
  return `${env().APP_URL}/api/connections/${provider}/callback`;
}

export async function listConnections(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: schema.emailConnections.id,
        provider: schema.emailConnections.provider,
        emailAddress: schema.emailConnections.emailAddress,
        status: schema.emailConnections.status,
        lastError: schema.emailConnections.lastError,
        lastSyncedAt: schema.emailConnections.lastSyncedAt,
        imported: schema.emailConnections.imported,
        createdAt: schema.emailConnections.createdAt,
      })
      .from(schema.emailConnections)
      .where(eq(schema.emailConnections.userId, userId))
      .orderBy(desc(schema.emailConnections.createdAt)),
  );
}

/** Called from the OAuth callback after state/PKCE were verified. Returns the connection id. */
export async function completeConnection(userId: string, providerId: MailProviderId, p: { code: string; codeVerifier: string }) {
  const provider = mailProvider(providerId);
  const tokens = await provider.exchangeCode({ code: p.code, codeVerifier: p.codeVerifier, redirectUri: redirectUri(providerId) });
  if (!tokens.refreshToken) throw new InputError("We couldn't get ongoing access to that inbox. Please try again.");
  const emailAddress = (await provider.profileEmail(tokens.accessToken)).toLowerCase();

  return withUser(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.emailConnections.id })
      .from(schema.emailConnections)
      .where(and(eq(schema.emailConnections.userId, userId), eq(schema.emailConnections.provider, providerId), eq(schema.emailConnections.emailAddress, emailAddress)));
    const values = {
      refreshTokenEnc: encryptField(tokens.refreshToken!),
      accessTokenEnc: encryptField(tokens.accessToken),
      accessExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      status: "active" as const,
      lastError: null,
    };
    let id: string;
    if (existing) {
      await tx.update(schema.emailConnections).set(values).where(eq(schema.emailConnections.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx.insert(schema.emailConnections).values({ userId, provider: providerId, emailAddress, ...values }).returning({ id: schema.emailConnections.id });
      id = row!.id;
    }
    await audit(tx, { userId, event: "email_connection.connected", entityType: "email_connection", entityId: id, metadata: { provider: providerId } });
    return id;
  });
}

export async function disconnect(userId: string, connectionId: string) {
  const [conn] = await withUser(userId, (tx) =>
    tx.select().from(schema.emailConnections).where(and(eq(schema.emailConnections.userId, userId), eq(schema.emailConnections.id, connectionId))),
  );
  if (!conn) throw new NotFoundError();
  try {
    await mailProvider(conn.provider).revoke(decryptField(conn.refreshTokenEnc));
  } catch {
    /* best effort: we delete our copy regardless */
  }
  await withUser(userId, async (tx) => {
    // Imported documents stay (they're the user's); the connection and its tokens go.
    await tx.update(schema.inboundMessages).set({ connectionId: null }).where(and(eq(schema.inboundMessages.userId, userId), eq(schema.inboundMessages.connectionId, connectionId)));
    await tx.delete(schema.emailConnections).where(eq(schema.emailConnections.id, connectionId));
    await audit(tx, { userId, event: "email_connection.disconnected", entityType: "email_connection", entityId: connectionId, metadata: { provider: conn.provider } });
  });
}

async function accessTokenFor(userId: string, conn: typeof schema.emailConnections.$inferSelect): Promise<string> {
  if (conn.accessTokenEnc && conn.accessExpiresAt && conn.accessExpiresAt.getTime() > Date.now()) return decryptField(conn.accessTokenEnc);
  let t: TokenSet;
  try {
    t = await mailProvider(conn.provider).refresh(decryptField(conn.refreshTokenEnc));
  } catch (e) {
    if (e instanceof ProviderError && e.authExpired) {
      await withUser(userId, (tx) =>
        tx.update(schema.emailConnections).set({ status: "error", lastError: "reconnect_required", accessTokenEnc: null }).where(eq(schema.emailConnections.id, conn.id)),
      );
    }
    throw e;
  }
  await withUser(userId, (tx) =>
    tx
      .update(schema.emailConnections)
      .set({ accessTokenEnc: encryptField(t.accessToken), accessExpiresAt: t.expiresAt, ...(t.refreshToken ? { refreshTokenEnc: encryptField(t.refreshToken) } : {}) })
      .where(eq(schema.emailConnections.id, conn.id)),
  );
  return t.accessToken;
}

export type SyncResult = { scanned: number; imported: number; skipped: number; duplicates: number; more: boolean };

/** Worker job. Idempotent: messages already seen are skipped by provider id. */
export async function syncConnection(userId: string, connectionId: string, opts: { now?: Date } = {}): Promise<SyncResult | null> {
  const [conn] = await withUser(userId, (tx) =>
    tx.select().from(schema.emailConnections).where(and(eq(schema.emailConnections.userId, userId), eq(schema.emailConnections.id, connectionId))),
  );
  if (!conn || conn.status === "revoked") return null;
  const now = opts.now ?? new Date();
  const provider = mailProvider(conn.provider);
  const since = conn.syncCursor ? new Date(conn.syncCursor) : new Date(now.getTime() - env().MAIL_SYNC_BACKFILL_DAYS * 86_400_000);
  const r: SyncResult = { scanned: 0, imported: 0, skipped: 0, duplicates: 0, more: false };

  try {
    const token = await accessTokenFor(userId, conn);
    const candidates = await provider.listCandidates(token, since, PER_SYNC_FETCH);
    r.more = candidates.length >= PER_SYNC_FETCH;
    const [user] = await db().select({ plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, userId));
    let cursor = since;

    for (const c of candidates) {
      if (r.imported >= PER_SYNC_IMPORT) {
        r.more = true;
        break;
      }
      r.scanned++;
      const providerMessageId = `${conn.provider}:${c.id}`;
      const [seen] = await withUser(userId, (tx) =>
        tx
          .select({ id: schema.inboundMessages.id })
          .from(schema.inboundMessages)
          .where(and(eq(schema.inboundMessages.userId, userId), eq(schema.inboundMessages.providerMessageId, providerMessageId))),
      );
      if (seen) {
        r.duplicates++;
        if (c.receivedAt > cursor) cursor = c.receivedAt;
        continue;
      }
      // Cheap pre-check on subject/sender before downloading anything.
      const pre = scoreEmail(readHeaders(`From: ${c.from}\r\nSubject: ${c.subject}\r\n\r\n`), "");
      let status: "skipped" | "ingested" | "rejected" = "skipped";
      let reason = pre.reasons.join(",");
      let score = pre.score;
      let documentId: string | null = null;
      let fromDomain = readHeaders(`From: ${c.from}\r\n\r\n`).fromDomain;

      if (pre.score >= IMPORT_THRESHOLD - 2) {
        const raw = await provider.fetchRaw(token, c.id);
        const h = readHeaders(raw.subarray(0, 64 * 1024).toString("latin1"));
        const rel = scoreEmail(h, raw.subarray(0, 40_000).toString("latin1"));
        score = rel.score;
        reason = rel.reasons.join(",");
        fromDomain = h.fromDomain;
        if (rel.score >= IMPORT_THRESHOLD) {
          const res = await ingest({ userId, plan: user?.plan, source: conn.provider, bytes: raw, filename: `${(h.subject || "Email").slice(0, 100)}.eml`, sourceRef: h.messageId ?? providerMessageId });
          if (res.status === "accepted") {
            status = "ingested";
            documentId = res.documentId;
            r.imported++;
          } else if (res.status === "duplicate") {
            r.duplicates++;
          } else {
            status = "rejected";
            reason = res.code;
            if (res.code === "limit_reached") {
              await record(userId, connectionId, providerMessageId, { status, score, reason, fromDomain, source: conn.provider, documentId });
              break;
            }
          }
        }
      }
      if (status === "skipped") r.skipped++;
      await record(userId, connectionId, providerMessageId, { status, score, reason, fromDomain, source: conn.provider, documentId });
      if (c.receivedAt > cursor) cursor = c.receivedAt;
    }

    await withUser(userId, async (tx) => {
      await tx
        .update(schema.emailConnections)
        .set({ syncCursor: cursor.toISOString(), lastSyncedAt: now, lastError: null, status: "active", imported: sql`${schema.emailConnections.imported} + ${r.imported}` })
        .where(eq(schema.emailConnections.id, connectionId));
    });
    return r;
  } catch (e) {
    const msg = e instanceof ProviderError && e.authExpired ? "reconnect_required" : "sync_failed";
    console.error("[mail-sync]", conn.provider, connectionId, (e as Error).message);
    await withUser(userId, (tx) =>
      tx
        .update(schema.emailConnections)
        .set({ lastError: msg, ...(msg === "reconnect_required" ? { status: "error" as const } : {}) })
        .where(eq(schema.emailConnections.id, connectionId)),
    );
    return null;
  }
}

async function record(
  userId: string,
  connectionId: string,
  providerMessageId: string,
  v: { status: "skipped" | "ingested" | "rejected"; score: number; reason: string; fromDomain: string | null; source: MailProviderId; documentId: string | null },
) {
  await withUser(userId, (tx) =>
    tx
      .insert(schema.inboundMessages)
      .values({ userId, connectionId, providerMessageId, relevanceScore: v.score, relevanceReason: v.reason || null, fromDomain: v.fromDomain, source: v.source, status: v.status, documentId: v.documentId })
      .onConflictDoNothing(),
  );
}

/** Scheduler: every active connection (ids only, via SECURITY DEFINER). */
export async function activeConnections() {
  const rows = await db().execute<{ id: string; user_id: string }>(sql`select id, user_id from app_active_email_connections()`);
  return rows.rows;
}
