import { and, desc, eq } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { schema, withUser } from "@/server/db/client";
import { enqueue } from "@/server/jobs/queue";
import { QUEUES } from "@/server/jobs/queues";
import { objectStore } from "@/server/storage/objectStore";

export class NotFoundError extends Error {
  status = 404;
  constructor() {
    super("not found");
  }
}

const listColumns = {
  id: schema.documents.id,
  originalFilename: schema.documents.originalFilename,
  mimeType: schema.documents.mimeType,
  sizeBytes: schema.documents.sizeBytes,
  source: schema.documents.source,
  status: schema.documents.status,
  stage: schema.documents.stage,
  failureReason: schema.documents.failureReason,
  createdAt: schema.documents.createdAt,
  processedAt: schema.documents.processedAt,
  processingMs: schema.documents.processingMs,
};

export async function listDocuments(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select(listColumns)
      .from(schema.documents)
      .where(eq(schema.documents.userId, userId))
      .orderBy(desc(schema.documents.createdAt)),
  );
}

export async function getDocument(userId: string, documentId: string) {
  const rows = await withUser(userId, (tx) =>
    tx
      .select(listColumns)
      .from(schema.documents)
      .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId))),
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/** Returns the original bytes after an ownership check. The only read path to storage. */
export async function getDocumentFile(userId: string, documentId: string, ipHash?: string | null) {
  const doc = await withUser(userId, async (tx) => {
    const [d] = await tx
      .select({
        storageKey: schema.documents.storageKey,
        mimeType: schema.documents.mimeType,
        originalFilename: schema.documents.originalFilename,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)));
    if (d) {
      await audit(tx, { userId, event: "document.viewed_original", entityType: "document", entityId: documentId, ipHash });
    }
    return d;
  });
  if (!doc) throw new NotFoundError();
  const bytes = await objectStore().get(doc.storageKey);
  return { bytes, mimeType: doc.mimeType, filename: doc.originalFilename };
}

/**
 * Hard delete: the blob, the document row, every extraction, and every item /
 * fact / action / reminder / protection derived from it (FK cascades).
 * The audit trail records that a deletion happened — not what was deleted.
 */
export async function deleteDocument(userId: string, documentId: string, ipHash?: string | null) {
  const storageKey = await withUser(userId, async (tx) => {
    const [d] = await tx
      .delete(schema.documents)
      .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)))
      .returning({ storageKey: schema.documents.storageKey });
    if (!d) return null;
    await audit(tx, { userId, event: "document.deleted", entityType: "document", entityId: documentId, ipHash });
    return d.storageKey;
  });
  if (!storageKey) throw new NotFoundError();
  try {
    await objectStore().delete(storageKey);
  } catch {
    // The row is gone; make sure the blob follows.
    await enqueue(QUEUES.deleteObject, { userId, storageKey });
  }
}
