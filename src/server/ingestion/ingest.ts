import { and, count, eq } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { schema, withUser } from "@/server/db/client";
import type { DocumentSource } from "@/server/domain/types";
import { entitlementsFor } from "@/server/entitlements";
import { env } from "@/server/env";
import { enqueue } from "@/server/jobs/queue";
import { QUEUES } from "@/server/jobs/queues";
import { sha256Hex } from "@/server/privacy/crypto";
import { newObjectKey, objectStore } from "@/server/storage/objectStore";
import { normalizeImage, NormalizationError } from "./normalize";
import { validateFile } from "./validateFile";

/**
 * The single entry point for every source: upload, sample, forwarded email,
 * and (later) Gmail / Outlook. Everything downstream is source-agnostic.
 */
export type RawInput = {
  userId: string;
  plan?: string;
  source: DocumentSource;
  bytes: Buffer;
  filename: string;
  /** Provider reference such as an email Message-ID. Never content. */
  sourceRef?: string;
  ipHash?: string | null;
};

export type IngestResult =
  | { status: "accepted"; documentId: string }
  | { status: "duplicate"; documentId: string }
  | { status: "rejected"; code: string; message: string };

export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001F\u007F<>:"|?*]/g, "").trim().slice(0, 120);
  return cleaned || "document";
}

export async function ingest(input: RawInput): Promise<IngestResult> {
  const v = await validateFile(input.bytes, env().MAX_UPLOAD_BYTES);
  if (!v.ok) return { status: "rejected", code: v.code, message: v.message };

  const sha256 = sha256Hex(input.bytes);
  const limits = entitlementsFor(input.plan);

  const pre = await withUser(input.userId, async (tx) => {
    const [dup] = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.userId, input.userId), eq(schema.documents.sha256, sha256)));
    if (dup) return { duplicateOf: dup.id } as const;
    if (limits.maxDocuments !== null) {
      const [c] = await tx
        .select({ n: count() })
        .from(schema.documents)
        .where(eq(schema.documents.userId, input.userId));
      if ((c?.n ?? 0) >= limits.maxDocuments) return { overLimit: true } as const;
    }
    return {} as const;
  });
  if ("duplicateOf" in pre && pre.duplicateOf) return { status: "duplicate", documentId: pre.duplicateOf };
  if ("overLimit" in pre) {
    return { status: "rejected", code: "limit_reached", message: "You've reached the document limit for your plan." };
  }

  // Photos are re-encoded BEFORE storage: EXIF (GPS, device) never persists.
  let stored = input.bytes;
  let storedMime = v.mimeType;
  if (v.kind === "image") {
    try {
      stored = (await normalizeImage(input.bytes)).sanitizedImage!;
      storedMime = "image/jpeg";
    } catch (e) {
      if (e instanceof NormalizationError) return { status: "rejected", code: "malformed", message: e.message };
      throw e;
    }
  }

  const storageKey = newObjectKey(input.userId);
  await objectStore().put(storageKey, stored, storedMime);

  let documentId: string;
  try {
    documentId = await withUser(input.userId, async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          userId: input.userId,
          source: input.source,
          sourceRef: input.sourceRef,
          storageKey,
          originalFilename: safeDisplayName(input.filename),
          mimeType: storedMime,
          sizeBytes: stored.length,
          sha256,
        })
        .onConflictDoNothing({ target: [schema.documents.userId, schema.documents.sha256] })
        .returning({ id: schema.documents.id });
      if (!doc) return "";
      await audit(tx, {
        userId: input.userId,
        event: "document.uploaded",
        entityType: "document",
        entityId: doc.id,
        metadata: { source: input.source, kind: v.kind, sizeBytes: input.bytes.length },
        ipHash: input.ipHash,
      });
      return doc.id;
    });
  } catch (e) {
    await objectStore().delete(storageKey).catch(() => undefined);
    throw e;
  }

  if (!documentId) {
    // Lost a race with a concurrent identical upload.
    await objectStore().delete(storageKey).catch(() => undefined);
    const existing = await withUser(input.userId, (tx) =>
      tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(eq(schema.documents.userId, input.userId), eq(schema.documents.sha256, sha256))),
    );
    return { status: "duplicate", documentId: existing[0]!.id };
  }

  await enqueue(QUEUES.processDocument, { userId: input.userId, documentId });
  return { status: "accepted", documentId };
}
