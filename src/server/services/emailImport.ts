import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { db, schema, withUser } from "@/server/db/client";
import { env } from "@/server/env";
import { readHeaders } from "@/server/ingestion/emailHeaders";
import { IMPORT_THRESHOLD, scoreEmail } from "@/server/ingestion/emailRelevance";
import { ingest } from "@/server/ingestion/ingest";
import { isAcceptedArchiveName, messagesFromArchive } from "@/server/ingestion/mailArchive";
import { enqueue } from "@/server/jobs/queue";
import { QUEUES } from "@/server/jobs/queues";
import { newObjectKey, objectStore } from "@/server/storage/objectStore";
import { NotFoundError } from "./documents";
import { InputError } from "./items";

/**
 * One-off import of past email from a Google Takeout export (.mbox or .zip).
 * The archive is scanned locally with the relevance filter; only likely
 * receipts, orders, trials, credits, warranties and bills are processed.
 * The archive itself is deleted as soon as the scan finishes.
 */

const DAILY_IMPORTS = 5;
const UNSUPPORTED = "Upload a mail export: .zip or .mbox (Gmail, Apple Mail, Thunderbird), .pst (Outlook), or .olm (Outlook for Mac).";

export async function startImport(userId: string, input: { filename: string; body: ReadableStream<Uint8Array>; declaredBytes: number | null }) {
  const max = env().MAX_IMPORT_BYTES;
  if (!isAcceptedArchiveName(input.filename)) throw new InputError(UNSUPPORTED);
  if (input.declaredBytes != null && input.declaredBytes > max) throw new InputError(`That file is larger than ${Math.round(max / 1024 / 1024)} MB.`);

  const recent = await withUser(userId, (tx) =>
    tx
      .select({ status: schema.emailImports.status })
      .from(schema.emailImports)
      .where(and(eq(schema.emailImports.userId, userId), gte(schema.emailImports.createdAt, new Date(Date.now() - 86_400_000)))),
  );
  if (recent.some((r) => r.status === "queued" || r.status === "scanning")) throw new InputError("An import is already running.");
  if (recent.length >= DAILY_IMPORTS) throw new InputError("You've reached today's import limit. Try again tomorrow.");

  const storageKey = newObjectKey(userId);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > max) cb(new InputError(`That file is larger than ${Math.round(max / 1024 / 1024)} MB.`));
      else cb(null, chunk);
    },
  });
  try {
    const body = Readable.fromWeb(input.body as never).pipe(counter);
    await objectStore().putStream(storageKey, body, "application/octet-stream");
  } catch (e) {
    await objectStore().delete(storageKey).catch(() => undefined);
    throw e;
  }
  if (bytes === 0) {
    await objectStore().delete(storageKey).catch(() => undefined);
    throw new InputError("That file is empty.");
  }

  const row = await withUser(userId, async (tx) => {
    const [r] = await tx
      .insert(schema.emailImports)
      .values({ userId, storageKey, filename: path.basename(input.filename).slice(0, 120), sizeBytes: bytes })
      .returning();
    await audit(tx, { userId, event: "email_import.started", entityType: "email_import", entityId: r!.id, metadata: { bytes } });
    return r!;
  });
  await enqueue(QUEUES.importMailbox, { userId, importId: row.id });
  return row;
}

export async function listImports(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: schema.emailImports.id,
        filename: schema.emailImports.filename,
        status: schema.emailImports.status,
        scanned: schema.emailImports.scanned,
        relevant: schema.emailImports.relevant,
        imported: schema.emailImports.imported,
        duplicates: schema.emailImports.duplicates,
        limitReached: schema.emailImports.limitReached,
        failureReason: schema.emailImports.failureReason,
        createdAt: schema.emailImports.createdAt,
        finishedAt: schema.emailImports.finishedAt,
      })
      .from(schema.emailImports)
      .where(eq(schema.emailImports.userId, userId))
      .orderBy(desc(schema.emailImports.createdAt))
      .limit(5),
  );
}

/** Worker job. Safe to retry: already-imported messages are de-duplicated by ingest(). */
export async function runImport(userId: string, importId: string, opts: { now?: Date; claimed?: boolean } = {}) {
  const [imp] = await withUser(userId, (tx) =>
    tx.select().from(schema.emailImports).where(and(eq(schema.emailImports.userId, userId), eq(schema.emailImports.id, importId))),
  );
  if (!imp) throw new NotFoundError();
  if (!imp.storageKey || imp.status === "done" || imp.status === "failed") return imp;
  if (!opts.claimed) {
    // Atomic claim so the worker and the web fallback never scan the same archive twice.
    const got = await withUser(userId, (tx) =>
      tx
        .update(schema.emailImports)
        .set({ status: "scanning" })
        .where(and(eq(schema.emailImports.id, importId), eq(schema.emailImports.status, "queued")))
        .returning({ id: schema.emailImports.id }),
    );
    if (!got.length) return imp;
  }

  const [user] = await db().select({ plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, userId));
  const maxDocs = env().MAX_IMPORT_DOCUMENTS;
  const now = (opts.now ?? new Date()).getTime();
  const counts = { scanned: 0, relevant: 0, imported: 0, duplicates: 0, limitReached: false };
  const save = (extra: Partial<typeof schema.emailImports.$inferInsert> = {}) =>
    withUser(userId, (tx) =>
      tx
        .update(schema.emailImports)
        .set({ ...counts, ...extra })
        .where(and(eq(schema.emailImports.userId, userId), eq(schema.emailImports.id, importId))),
    );

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lifeos-import-"));
  const tmp = path.join(tmpDir, "archive");
  try {
    await pipeline(await objectStore().getStream(imp.storageKey), createWriteStream(tmp, { mode: 0o600 }));
    for await (const msg of messagesFromArchive(tmp, tmpDir)) {
      counts.scanned++;
      if (counts.scanned % 250 === 0) await save();
      if (msg.oversized) continue;
      const h = readHeaders(msg.raw.subarray(0, 64 * 1024).toString("latin1"));
      const rel = scoreEmail(h, msg.raw.subarray(0, 40_000).toString("latin1"));
      if (rel.score < IMPORT_THRESHOLD) continue;
      // Old mail rarely has open deadlines; warranties last longer.
      const ageDays = h.date ? (now - h.date.getTime()) / 86_400_000 : 0;
      if (ageDays > (rel.category === "warranty" ? 3 * 365 : 400)) continue;
      counts.relevant++;
      const subject = h.subject.slice(0, 100) || "Email";
      const r = await ingest({ userId, plan: user?.plan, source: "email_import", bytes: msg.raw, filename: `${subject}.eml`, sourceRef: h.messageId ?? undefined });
      if (r.status === "accepted") counts.imported++;
      else if (r.status === "duplicate") counts.duplicates++;
      else if (r.code === "limit_reached") {
        counts.limitReached = true;
        break;
      }
      if (counts.imported >= maxDocs) {
        counts.limitReached = true;
        break;
      }
    }
    if (counts.scanned === 0) {
      await save({ status: "failed", failureReason: "We couldn't find any emails in that file. Check it's a mail export (.zip, .mbox, .pst or .olm).", finishedAt: new Date() });
    } else {
      await save({ status: "done", finishedAt: new Date() });
    }
  } catch (e) {
    console.error("[import] failed", importId, (e as Error).message);
    await save({ status: "failed", failureReason: "We couldn't read that file. Check it's a mail export (.zip, .mbox, .pst or .olm) and try again.", finishedAt: new Date() });
  } finally {
    // Privacy: the archive (the user's whole mailbox) never outlives the scan.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    await objectStore().delete(imp.storageKey).catch(() => undefined);
    await withUser(userId, async (tx) => {
      await tx.update(schema.emailImports).set({ storageKey: null }).where(and(eq(schema.emailImports.userId, userId), eq(schema.emailImports.id, importId)));
      await audit(tx, { userId, actor: "worker", event: "email_import.finished", entityType: "email_import", entityId: importId, metadata: { ...counts } });
    });
  }
  return { ...imp, ...counts };
}

/**
 * Imports still "queued" after 30s (no worker running) are claimed atomically so
 * the web process can run them, like the document fallback. Returns claimed ids.
 */
export async function claimStuckImports(userId: string, now = new Date()) {
  const rows = await withUser(userId, (tx) =>
    tx
      .update(schema.emailImports)
      .set({ status: "scanning" })
      .where(
        and(
          eq(schema.emailImports.userId, userId),
          eq(schema.emailImports.status, "queued"),
          lt(schema.emailImports.createdAt, new Date(now.getTime() - 30_000)),
        ),
      )
      .returning({ id: schema.emailImports.id }),
  );
  return rows.map((r) => r.id);
}
