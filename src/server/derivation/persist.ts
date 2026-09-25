import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/server/db/client";
import { daysBetween } from "@/server/extraction/dates";
import { encryptField } from "@/server/privacy/crypto";
import type { DerivedItem } from "./derive";
import { priorityReason, priorityScore } from "./priority";

let categoryIds: Map<string, string> | undefined;
async function categoryMap(tx: Tx) {
  if (!categoryIds) {
    const rows = await tx.select().from(schema.categories);
    categoryIds = new Map(rows.map((r) => [r.slug, r.id]));
  }
  return categoryIds;
}

type DuplicateMatch = { itemId: string; conflict: string | null };

/**
 * Same purchase/credit/subscription arriving from a second document (receipt +
 * order email, re-sent notice). We flag rather than merge: the user decides.
 */
async function findDuplicate(tx: Tx, userId: string, documentId: string, item: DerivedItem): Promise<DuplicateMatch | null> {
  const others = await tx
    .select({ id: schema.items.id, merchant: schema.items.merchant, amountCents: schema.items.amountCents, primaryDate: schema.items.primaryDate })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), eq(schema.items.kind, item.kind), ne(schema.items.documentId, documentId), sql`${schema.items.possibleDuplicateOf} is null`));
  if (!others.length) return null;

  if (item.kind === "purchase" && item.typed.purchase) {
    const p = item.typed.purchase;
    const rows = await tx
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.userId, userId), inArray(schema.purchases.itemId, others.map((o) => o.id))));
    for (const r of rows) {
      const other = others.find((o) => o.id === r.itemId)!;
      const sameOrder = !!p.orderNumber && !!r.orderNumber && norm(p.orderNumber) === norm(r.orderNumber);
      const sameShape =
        !!item.merchant && norm(item.merchant) === norm(other.merchant ?? "") &&
        p.totalCents != null && p.totalCents === r.totalCents &&
        !!p.purchaseDate && !!r.purchaseDate && Math.abs(daysBetween(p.purchaseDate, r.purchaseDate)) <= 3;
      if (sameOrder || sameShape) {
        const conflicts: string[] = [];
        if (p.totalCents != null && r.totalCents != null && p.totalCents !== r.totalCents) conflicts.push("total");
        if (p.purchaseDate && r.purchaseDate && p.purchaseDate !== r.purchaseDate) conflicts.push("purchase date");
        if (p.returnDeadline && r.returnDeadline && p.returnDeadline !== r.returnDeadline && p.returnDeadlineCertainty === "confirmed" && r.returnDeadlineCertainty === "confirmed") conflicts.push("return deadline");
        return { itemId: r.itemId, conflict: conflicts.length ? `Another document for this order shows a different ${conflicts.join(" and ")}.` : null };
      }
    }
    return null;
  }

  for (const o of others) {
    if (
      item.merchant && o.merchant && norm(item.merchant) === norm(o.merchant) &&
      item.amountCents != null && item.amountCents === o.amountCents &&
      item.primaryDate && o.primaryDate === item.primaryDate
    ) {
      return { itemId: o.id, conflict: null };
    }
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Writes derived items in the caller's transaction. Replaces anything
 * previously derived from this document, so re-processing is idempotent.
 */
export async function persistDerivedItems(
  tx: Tx,
  args: { userId: string; documentId: string; extractionId: string | null; items: DerivedItem[]; today: string },
): Promise<string[]> {
  const { userId, documentId, extractionId, today } = args;
  await tx.delete(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.documentId, documentId)));
  const cats = await categoryMap(tx);
  const ids: string[] = [];

  for (const item of args.items) {
    const dup = item.kind === "document" ? null : await findDuplicate(tx, userId, documentId, item);
    const [row] = await tx
      .insert(schema.items)
      .values({
        userId,
        documentId,
        extractionId,
        kind: item.kind,
        title: item.title,
        merchant: item.merchant,
        amountCents: item.amountCents,
        currency: item.currency,
        primaryDate: item.primaryDate,
        details: item.details,
        confidence: item.confidence,
        needsReview: item.needsReview || !!dup?.conflict,
        possibleDuplicateOf: dup?.itemId ?? null,
        conflictNote: dup?.conflict ?? null,
      })
      .returning({ id: schema.items.id });
    const itemId = row!.id;
    ids.push(itemId);

    if (dup?.conflict) {
      await tx
        .update(schema.items)
        .set({ conflictNote: dup.conflict, needsReview: true })
        .where(and(eq(schema.items.userId, userId), eq(schema.items.id, dup.itemId)));
    }

    const catRows = item.categories.map((slug) => cats.get(slug)).filter(Boolean).map((categoryId) => ({ itemId, categoryId: categoryId!, userId }));
    if (catRows.length) await tx.insert(schema.itemCategories).values(catRows).onConflictDoNothing();

    if (item.facts.length) {
      await tx.insert(schema.itemFacts).values(
        item.facts.map((f, i) => ({
          userId,
          itemId,
          key: f.key,
          label: f.label,
          valueText: f.valueText ?? null,
          currency: f.currency ?? null,
          valueDate: f.valueDate ?? null,
          valueCents: f.valueCents ?? null,
          valueNumber: f.valueNumber ?? null,
          certainty: f.certainty,
          basis: f.basis,
          evidence: f.evidence,
          explanation: f.explanation,
          confidence: f.confidence,
          sortOrder: i,
        })),
      );
    }

    await writeTypedProjections(tx, userId, itemId, item);

    const protectionIds = new Map<string, string>();
    for (const p of item.protections) {
      const [pr] = await tx
        .insert(schema.protections)
        .values({ userId, itemId, kind: p.kind, amountCents: p.amountCents, currency: p.currency, activeUntil: p.activeUntil, certainty: p.certainty, status: p.status })
        .returning({ id: schema.protections.id });
      protectionIds.set(p.kind, pr!.id);
    }

    // Suspected duplicates don't generate a second set of reminders/actions.
    if (!dup) {
      for (const a of item.actions) {
        await tx.insert(schema.actions).values({
          userId,
          itemId,
          protectionId: a.protectionKind ? protectionIds.get(a.protectionKind) ?? null : null,
          type: a.type,
          title: a.title,
          description: a.description,
          dueOn: a.dueOn,
          dueCertainty: a.dueCertainty,
          estimatedValueCents: a.estimatedValueCents,
          currency: a.currency,
          consequence: a.consequence,
          priorityScore: priorityScore(a, today),
          priorityReason: priorityReason(a, today),
          suggestedAction: a.suggestedAction,
          confidence: a.confidence,
        });
      }
    }
  }
  return ids;
}

export async function writeTypedProjections(tx: Tx, userId: string, itemId: string, item: DerivedItem) {
  const t = item.typed;
  if (t.purchase) {
    await tx.insert(schema.purchases).values({ itemId, userId, ...t.purchase }).onConflictDoUpdate({ target: schema.purchases.itemId, set: { ...t.purchase } });
  }
  if (t.subscription) {
    await tx.insert(schema.subscriptions).values({ itemId, userId, ...t.subscription }).onConflictDoUpdate({ target: schema.subscriptions.itemId, set: { ...t.subscription } });
  }
  if (t.warranty) {
    const v = { ...t.warranty, coveredItemId: item.kind === "purchase" ? itemId : null };
    await tx.insert(schema.warranties).values({ itemId, userId, ...v }).onConflictDoUpdate({ target: schema.warranties.itemId, set: v });
  }
  if (t.travelCredit) {
    const { creditReference, ...rest } = t.travelCredit;
    const v = { ...rest, creditReferenceEnc: creditReference ? encryptField(creditReference) : null };
    await tx.insert(schema.travelCredits).values({ itemId, userId, ...v }).onConflictDoUpdate({ target: schema.travelCredits.itemId, set: v });
  }
}
