import { and, eq } from "drizzle-orm";
import { getProvider, AIProviderError, type AIProvider, type ContentPart } from "@/server/ai/provider";
import { audit } from "@/server/audit/log";
import { db, schema, withUser } from "@/server/db/client";
import {
  deriveFiledDocument,
  deriveGeneric,
  derivePurchase,
  deriveSubscription,
  deriveTravelCredit,
  deriveWarranty,
  type DerivedItem,
} from "@/server/derivation/derive";
import { persistDerivedItems } from "@/server/derivation/persist";
import type { DocumentStage, DocumentStatus } from "@/server/domain/types";
import { normalize, NormalizationError, type NormalizedDocument } from "@/server/ingestion/normalize";
import type { AcceptedKind } from "@/server/ingestion/validateFile";
import { redact } from "@/server/privacy/redact";
import { objectStore } from "@/server/storage/objectStore";
import { detectDateOrder, todayIn } from "./dates";
import { DocumentIndex } from "./grounding";
import { CLASSIFY_SYSTEM, documentBlock, extractSystem, PROMPT_VERSION, TRANSCRIBE_SYSTEM } from "./prompts";
import {
  classificationSchema,
  familyFor,
  SCHEMA_VERSION,
  SCHEMAS,
  transcriptionSchema,
  type Classification,
  type DocumentType,
  type ExtractionByFamily,
  type ExtractionFamily,
} from "./schemas";
import {
  verifyGeneric,
  verifyPurchase,
  verifySubscription,
  verifyTravelCredit,
  verifyWarranty,
  type VerifyContext,
} from "./verify";

const READ_CAP = { good: 0.9, partial: 0.7, poor: 0.45 } as const;

function kindFromMime(mime: string): AcceptedKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime === "message/rfc822") return "email";
  return "text";
}

async function setStage(userId: string, documentId: string, stage: DocumentStage, status?: DocumentStatus) {
  await withUser(userId, (tx) =>
    tx
      .update(schema.documents)
      .set({ stage, ...(status ? { status } : {}) })
      .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId))),
  );
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AIProviderError && e.retryable) return fn();
    throw e;
  }
}

export type PipelineOutcome = {
  status: DocumentStatus;
  documentType: DocumentType | null;
  itemIds: string[];
  warnings: string[];
  processingMs: number;
};

/**
 * Upload → understand → extract → verify → derive → persist.
 * Pure-ish stages are in their own modules; this function orchestrates and
 * records progress so the UI can show what is really happening.
 */
export async function processDocument(userId: string, documentId: string, opts: { now?: Date } = {}): Promise<PipelineOutcome> {
  const started = Date.now();
  const doc = await withUser(userId, async (tx) => {
    const [d] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)));
    return d;
  });
  if (!doc) throw new Error("document not found");

  // Users table is outside RLS; we read only what redaction and dates need.
  const [user] = await db()
    .select({ name: schema.users.name, email: schema.users.email, timezone: schema.users.timezone })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const today = todayIn(user?.timezone ?? "America/New_York", opts.now);

  const provider: AIProvider = doc.source === "sample" ? await getProvider("mock") : await getProvider();
  const warnings: string[] = [];

  const fail = async (status: DocumentStatus, reason: string): Promise<PipelineOutcome> => {
    const processingMs = Date.now() - started;
    await withUser(userId, async (tx) => {
      await tx
        .update(schema.documents)
        .set({ status, stage: status === "failed" ? "failed" : "done", failureReason: reason, processedAt: new Date(), processingMs })
        .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)));
      await audit(tx, { userId, actor: "worker", event: `document.${status}`, entityType: "document", entityId: documentId });
    });
    return { status, documentType: null, itemIds: [], warnings, processingMs };
  };

  try {
    // ── Read
    await setStage(userId, documentId, "reading", "processing");
    const bytes = await objectStore().get(doc.storageKey);
    let normalized: NormalizedDocument;
    try {
      normalized = await normalize(kindFromMime(doc.mimeType), bytes);
    } catch (e) {
      if (e instanceof NormalizationError) return fail("unsupported", e.message);
      throw e;
    }

    let text = normalized.text;
    let readCap = 1;
    const hints = { sourceSha256: doc.sha256 };
    if (normalized.visual) {
      const visual: ContentPart =
        normalized.visual.kind === "image"
          ? { type: "image", mimeType: "image/jpeg", data: normalized.visual.data }
          : { type: "pdf", data: normalized.visual.data };
      const t = await withRetry(() =>
        provider.generate({ task: "transcribe", tier: "strong", system: TRANSCRIBE_SYSTEM, content: [visual], schema: transcriptionSchema, localHints: hints }),
      );
      text = t.data.text;
      readCap = READ_CAP[t.data.legibility];
      if (t.data.legibility === "poor") warnings.push("poor_legibility");
      if (text.replace(/\[illegible\]/g, "").trim().length < 20) {
        return fail("needs_review", "We couldn't read enough of this image. Try a clearer photo.");
      }
    }

    const { text: safeText } = redact(text, { name: user?.name, email: user?.email });
    await withUser(userId, (tx) =>
      tx.update(schema.documents).set({ textContent: safeText, pageCount: normalized.pageCount }).where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId))),
    );

    // ── Classify
    await setStage(userId, documentId, "classifying");
    const content: ContentPart[] = [{ type: "text", text: documentBlock(safeText) }];
    const cls = await withRetry(() =>
      provider.generate({ task: "classify", tier: "fast", system: CLASSIFY_SYSTEM, content, schema: classificationSchema, localHints: hints }),
    );
    const classification: Classification = cls.data;
    const family = familyFor(classification.document_type);

    let items: DerivedItem[];
    let extractionRaw: unknown = null;
    let extractionOutput: unknown = null;
    let secrets: string[] = [];
    let extractionModel = cls.model;
    let tokens = { in: cls.usage.inputTokens, out: cls.usage.outputTokens };

    if (classification.document_type === "unreadable") {
      return fail("needs_review", "This document was too hard to read. Try a clearer copy.");
    }

    if (!family || classification.confidence < 0.4 || (family === "generic" && !classification.is_actionable)) {
      items = [deriveFiledDocument(doc.originalFilename.replace(/\.[a-z0-9]+$/i, ""))];
    } else {
      // ── Extract
      await setStage(userId, documentId, "extracting");
      const ex = await withRetry(() =>
        provider.generate({
          task: "extract",
          tier: "strong",
          system: extractSystem(family),
          content,
          schema: SCHEMAS[family] as never,
          localHints: hints,
        }),
      );
      extractionRaw = ex.raw;
      extractionModel = ex.model;
      tokens = { in: tokens.in + ex.usage.inputTokens, out: tokens.out + ex.usage.outputTokens };

      // ── Verify (deterministic)
      await setStage(userId, documentId, "verifying");
      const index = new DocumentIndex(safeText);
      const ctx: VerifyContext = {
        index,
        today,
        referenceIso: normalized.meta.emailDate && index.containsStrict(`Date: ${normalized.meta.emailDate}`) ? normalized.meta.emailDate : null,
        order: detectDateOrder(safeText),
        readCap,
        warnings,
      };

      await setStage(userId, documentId, "checking_policies");
      const dctx = { today, classificationConfidence: classification.confidence, documentType: classification.document_type, warnings };
      ({ items, output: extractionOutput, secrets = [] } = deriveFamily(family, ex.data as never, ctx, dctx));
    }

    // ── Persist
    await setStage(userId, documentId, "finding_actions");
    const needsReview = items.some((i) => i.needsReview);
    const processingMs = Date.now() - started;
    let status: DocumentStatus = needsReview ? "needs_review" : "processed";
    // Credit / confirmation codes live only in their encrypted column.
    const scrub = (s: string) => secrets.reduce((acc, sec) => acc.split(sec).join(`••••${sec.slice(-3)}`), s);
    if (secrets.length) extractionRaw = JSON.parse(scrub(JSON.stringify(extractionRaw)));
    const itemIds = await withUser(userId, async (tx) => {
      const [extraction] = await tx
        .insert(schema.documentExtractions)
        .values({
          userId,
          documentId,
          documentType: classification.document_type,
          classificationConfidence: classification.confidence,
          provider: provider.id,
          model: extractionModel,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          rawOutput: extractionRaw,
          output: extractionOutput,
          warnings,
          overallConfidence: items.length ? Math.min(...items.map((i) => i.confidence)) : 0,
          inputTokens: tokens.in,
          outputTokens: tokens.out,
          latencyMs: processingMs,
        })
        .returning({ id: schema.documentExtractions.id });
      const { ids, conflicts } = await persistDerivedItems(tx, { userId, documentId, extractionId: extraction!.id, items, today });
      if (conflicts) status = "needs_review";
      await tx
        .update(schema.documents)
        .set({ status, stage: "done", failureReason: null, processedAt: new Date(), processingMs, ...(secrets.length ? { textContent: scrub(safeText) } : {}) })
        .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)));
      await audit(tx, {
        userId,
        actor: "worker",
        event: "document.processed",
        entityType: "document",
        entityId: documentId,
        metadata: { documentType: classification.document_type, items: ids.length, warnings: warnings.length, ms: processingMs },
      });
      return ids;
    });

    return { status, documentType: classification.document_type, itemIds, warnings, processingMs };
  } catch (e) {
    console.error("[pipeline] failed", documentId, (e as Error).message);
    return fail("failed", "Something went wrong while reading this document. You can try again.");
  }
}

function deriveFamily(
  family: ExtractionFamily,
  data: ExtractionByFamily[ExtractionFamily],
  ctx: VerifyContext,
  dctx: Parameters<typeof derivePurchase>[1],
): { items: DerivedItem[]; output: unknown; secrets?: string[] } {
  switch (family) {
    case "purchase": {
      const v = verifyPurchase(data as ExtractionByFamily["purchase"], ctx);
      const items = v.map((o) => derivePurchase(o, dctx));
      return { items: items.length ? items : [deriveFiledDocument("Receipt")], output: v };
    }
    case "subscription": {
      const v = verifySubscription(data as ExtractionByFamily["subscription"], ctx);
      return { items: [deriveSubscription(v, dctx)], output: v };
    }
    case "warranty": {
      const v = verifyWarranty(data as ExtractionByFamily["warranty"], ctx);
      return { items: [deriveWarranty(v, dctx)], output: v };
    }
    case "travel_credit": {
      const v = verifyTravelCredit(data as ExtractionByFamily["travel_credit"], ctx);
      // Never persist the plaintext credit code in the extraction JSON.
      const output = { ...v, creditCode: v.creditCode.value ? { ...v.creditCode, value: "[encrypted]", evidence: null } : v.creditCode };
      return { items: [deriveTravelCredit(v, dctx)], output, secrets: v.creditCode.value ? [v.creditCode.value] : [] };
    }
    case "generic": {
      const v = verifyGeneric(data as ExtractionByFamily["generic"], ctx);
      return { items: [deriveGeneric(v, dctx)], output: v };
    }
  }
}
