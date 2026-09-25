import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/server/db/client";
import { planFromFacts, type FactLike } from "@/server/derivation/plan";
import { priorityReason, priorityScore } from "@/server/derivation/priority";
import { rescheduleForAction } from "./reminders";

/**
 * Re-plan an item's protections and actions from its (possibly edited) facts
 * and refresh the typed projections. Action status (done/dismissed/snoozed)
 * and reminders survive; due dates and amounts follow the facts.
 */
export async function syncItemFromFacts(tx: Tx, userId: string, itemId: string, today: string, tz: string) {
  const [item] = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId)));
  if (!item) return;
  const facts = await tx.select().from(schema.itemFacts).where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, itemId)));
  const factLikes: FactLike[] = facts.map((f) => ({ ...f }));
  const plan = planFromFacts({ kind: item.kind, title: item.title, merchant: item.merchant, facts: factLikes, details: item.details }, today);
  const get = (k: string) => facts.find((f) => f.key === k);

  // ── Protections
  const existingP = await tx.select().from(schema.protections).where(and(eq(schema.protections.userId, userId), eq(schema.protections.itemId, itemId)));
  const pIds = new Map<string, string>();
  for (const p of plan.protections) {
    const ex = existingP.find((e) => e.kind === p.kind);
    if (ex) {
      const locked = ex.status === "used" || ex.status === "dismissed";
      await tx
        .update(schema.protections)
        .set({ amountCents: p.amountCents, currency: p.currency, activeUntil: p.activeUntil, certainty: p.certainty, ...(locked ? {} : { status: p.status }) })
        .where(eq(schema.protections.id, ex.id));
      pIds.set(p.kind, ex.id);
    } else {
      const [row] = await tx.insert(schema.protections).values({ userId, itemId, ...p }).returning({ id: schema.protections.id });
      pIds.set(p.kind, row!.id);
    }
  }
  const staleP = existingP.filter((e) => !plan.protections.some((p) => p.kind === e.kind) && e.status !== "used").map((e) => e.id);
  if (staleP.length) await tx.delete(schema.protections).where(inArray(schema.protections.id, staleP));

  // ── Actions (suspected duplicates stay action-less)
  const planned = item.possibleDuplicateOf ? [] : plan.actions;
  const existingA = await tx.select().from(schema.actions).where(and(eq(schema.actions.userId, userId), eq(schema.actions.itemId, itemId)));
  for (const a of planned) {
    const values = {
      title: a.title,
      description: a.description,
      dueOn: a.dueOn,
      dueCertainty: a.dueCertainty,
      estimatedValueCents: a.estimatedValueCents,
      currency: a.currency,
      consequence: a.consequence,
      suggestedAction: a.suggestedAction,
      confidence: a.confidence,
      protectionId: a.protectionKind ? pIds.get(a.protectionKind) ?? null : null,
      priorityScore: priorityScore({ ...a, userImportance: item.userImportance }, today),
      priorityReason: priorityReason(a, today),
    };
    const ex = existingA.find((e) => e.type === a.type);
    if (ex) {
      await tx.update(schema.actions).set(values).where(eq(schema.actions.id, ex.id));
      if (ex.dueOn !== a.dueOn) await rescheduleForAction(tx, userId, ex.id, a.dueOn, tz);
    } else {
      await tx.insert(schema.actions).values({ userId, itemId, type: a.type, ...values });
    }
  }
  const staleA = existingA.filter((e) => !planned.some((a) => a.type === e.type) && e.status !== "done").map((e) => e.id);
  if (staleA.length) await tx.delete(schema.actions).where(inArray(schema.actions.id, staleA));

  // ── Item summary + typed projections
  const amountKey = item.kind === "purchase" ? "total" : item.kind === "warranty" ? "purchase_price" : "amount";
  const amount = get(amountKey);
  const primaryKey =
    item.kind === "purchase" ? "purchase_date" : item.kind === "subscription" ? (get("trial_end")?.valueDate ? "trial_end" : "next_renewal") : item.kind === "warranty" ? "warranty_end" : item.kind === "travel_credit" ? "expires_on" : null;
  await tx
    .update(schema.items)
    .set({
      amountCents: amount?.certainty !== "unknown" ? amount?.valueCents ?? null : null,
      currency: amount?.currency ?? item.currency,
      primaryDate: primaryKey ? get(primaryKey)?.valueDate ?? null : item.primaryDate,
      needsReview: facts.some((f) => f.certainty === "estimated" && (f.basis === "unclear_on_document" || f.basis === "inferred") && !f.userConfirmedAt),
    })
    .where(eq(schema.items.id, itemId));

  if (item.kind === "purchase") {
    const ret = get("return_deadline");
    await tx
      .update(schema.purchases)
      .set({
        purchaseDate: get("purchase_date")?.valueDate ?? null,
        totalCents: get("total")?.valueCents ?? null,
        returnDeadline: ret?.valueDate ?? null,
        returnDeadlineCertainty: ret?.certainty ?? "unknown",
      })
      .where(eq(schema.purchases.itemId, itemId));
    const war = get("warranty");
    if (war?.valueDate) {
      await tx
        .insert(schema.warranties)
        .values({ itemId, userId, coveredItemId: itemId, startsOn: get("purchase_date")?.valueDate ?? null, endsOn: war.valueDate, durationMonths: war.valueNumber ?? null, endsOnCertainty: war.certainty })
        .onConflictDoUpdate({ target: schema.warranties.itemId, set: { endsOn: war.valueDate, endsOnCertainty: war.certainty, startsOn: get("purchase_date")?.valueDate ?? null } });
    }
  } else if (item.kind === "subscription") {
    const renew = get("next_renewal");
    const trial = get("trial_end");
    await tx
      .update(schema.subscriptions)
      .set({
        amountCents: get("amount")?.valueCents ?? null,
        trialEndsOn: trial?.valueDate ?? null,
        nextRenewalOn: renew?.valueDate ?? trial?.valueDate ?? null,
        renewalCertainty: renew?.valueDate ? renew.certainty : trial?.certainty ?? "unknown",
      })
      .where(eq(schema.subscriptions.itemId, itemId));
  } else if (item.kind === "warranty") {
    const end = get("warranty_end");
    await tx.update(schema.warranties).set({ endsOn: end?.valueDate ?? null, endsOnCertainty: end?.certainty ?? "unknown" }).where(eq(schema.warranties.itemId, itemId));
  } else if (item.kind === "travel_credit") {
    const exp = get("expires_on");
    await tx
      .update(schema.travelCredits)
      .set({ amountCents: get("amount")?.valueCents ?? null, expiresOn: exp?.valueDate ?? null, expiresOnCertainty: exp?.certainty ?? "unknown" })
      .where(eq(schema.travelCredits.itemId, itemId));
  }
}
