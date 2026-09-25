import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { db, schema, withUser, type Tx } from "@/server/db/client";
import { durationText } from "@/server/derivation/derive";
import { priorityReason, priorityScore, relativeDays, tierFor, type Tier } from "@/server/derivation/priority";
import type { ActionStatus, Certainty, ItemState, OutcomeKind } from "@/server/domain/types";
import { addDays, addMonths, daysBetween, formatDate, isValidIso, todayIn } from "@/server/extraction/dates";
import { formatMoney } from "@/lib/money";
import { NotFoundError } from "./documents";
import { syncItemFromFacts } from "./sync";

export class InputError extends Error {
  status = 400;
}

export async function userContext(userId: string, now?: Date) {
  const [u] = await db().select({ timezone: schema.users.timezone }).from(schema.users).where(eq(schema.users.id, userId));
  const tz = u?.timezone ?? "America/New_York";
  return { tz, today: todayIn(tz, now) };
}

// ───────────────────────────── Dashboard ─────────────────────────────

export type ActionCard = {
  actionId: string;
  itemId: string;
  type: string;
  title: string;
  itemTitle: string;
  itemKind: string;
  merchant: string | null;
  dueOn: string | null;
  dueCertainty: Certainty;
  relative: string | null;
  reason: string;
  explanation: string | null;
  valueCents: number | null;
  currency: string | null;
  score: number;
  tier: Tier;
  status: ActionStatus;
  needsReview: boolean;
  reminderAt: Date | null;
};

export type ItemCard = {
  id: string;
  kind: string;
  title: string;
  merchant: string | null;
  amountCents: number | null;
  currency: string | null;
  primaryDate: string | null;
  needsReview: boolean;
  state: ItemState;
  createdAt: Date;
  possibleDuplicate: boolean;
  headline: string | null;
};

export type MoneySummary = { protectedCents: number; currency: string; itemCount: number; savedCents: number };

export async function moneySummary(tx: Tx, userId: string, today: string): Promise<MoneySummary> {
  // Money Protected: per item, the largest ACTIVE opportunity with a known date.
  // Counted once per item (a TV's return window and warranty don't add up).
  const rows = await tx.execute<{ currency: string; cents: string; items: string }>(sql`
    select p.currency, sum(p.max_cents)::bigint as cents, count(*)::int as items from (
      select pr.item_id, pr.currency, max(pr.amount_cents) as max_cents
      from protections pr join items i on i.id = pr.item_id
      where pr.user_id = ${userId} and pr.status = 'active' and pr.certainty <> 'unknown'
        and pr.active_until is not null and pr.active_until >= ${today}
        and i.state in ('active', 'saved') and i.possible_duplicate_of is null
      group by pr.item_id, pr.currency
    ) p group by p.currency order by cents desc`);
  const [saved] = await tx
    .select({ cents: sql<string>`coalesce(sum(${schema.financialOutcomes.amountCents}), 0)` })
    .from(schema.financialOutcomes)
    .where(eq(schema.financialOutcomes.userId, userId));
  const top = rows.rows[0];
  return {
    protectedCents: top ? Number(top.cents) : 0,
    currency: top?.currency ?? "USD",
    itemCount: top ? Number(top.items) : 0,
    savedCents: Number(saved?.cents ?? 0),
  };
}

function toActionCard(
  a: typeof schema.actions.$inferSelect,
  it: { title: string; kind: string; merchant: string | null; needsReview: boolean; userImportance: number },
  today: string,
  reminderAt: Date | null,
): ActionCard {
  const p = { ...a, userImportance: it.userImportance };
  return {
    actionId: a.id,
    itemId: a.itemId,
    type: a.type,
    title: a.title,
    itemTitle: it.title,
    itemKind: it.kind,
    merchant: it.merchant,
    dueOn: a.dueOn,
    dueCertainty: a.dueCertainty,
    relative: a.dueOn ? relativeDays(today, a.dueOn) : null,
    reason: priorityReason(p, today),
    explanation: a.description,
    valueCents: a.estimatedValueCents,
    currency: a.currency,
    score: priorityScore(p, today),
    tier: tierFor(p, today),
    status: a.status,
    needsReview: it.needsReview,
    reminderAt,
  };
}

export async function getDashboard(userId: string, opts: { now?: Date } = {}) {
  const { today } = await userContext(userId, opts.now);
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ action: schema.actions, item: schema.items })
      .from(schema.actions)
      .innerJoin(schema.items, eq(schema.items.id, schema.actions.itemId))
      .where(
        and(
          eq(schema.actions.userId, userId),
          or(eq(schema.actions.status, "open"), and(eq(schema.actions.status, "snoozed"), lte(schema.actions.snoozedUntil, today))),
          inArray(schema.items.state, ["active", "saved"]),
          isNull(schema.items.possibleDuplicateOf),
        ),
      );
    const reminders = await tx
      .select({ actionId: schema.reminders.actionId, remindAt: schema.reminders.remindAt })
      .from(schema.reminders)
      .where(and(eq(schema.reminders.userId, userId), eq(schema.reminders.status, "scheduled")));
    const remindMap = new Map(reminders.map((r) => [r.actionId, r.remindAt]));

    const cards = rows
      .map((r) => toActionCard(r.action, r.item, today, remindMap.get(r.action.id) ?? null))
      .sort((a, b) => b.score - a.score);

    const since = new Date(Date.now() - 7 * 86_400_000);
    const recent = await tx
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.userId, userId), eq(schema.items.state, "active"), gte(schema.items.createdAt, since)))
      .orderBy(desc(schema.items.createdAt))
      .limit(8);
    const saved = await tx
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.userId, userId), eq(schema.items.state, "saved")))
      .orderBy(desc(schema.items.updatedAt))
      .limit(12);

    const processing = await tx
      .select({ id: schema.documents.id, originalFilename: schema.documents.originalFilename, stage: schema.documents.stage, status: schema.documents.status })
      .from(schema.documents)
      .where(and(eq(schema.documents.userId, userId), inArray(schema.documents.status, ["queued", "processing"])));

    const [counts] = await tx
      .select({ items: sql<number>`count(*)::int`, docs: sql<number>`(select count(*)::int from documents where user_id = ${userId})` })
      .from(schema.items)
      .where(eq(schema.items.userId, userId));

    return {
      today,
      needsAttention: cards.filter((c) => c.tier === "needs_attention"),
      comingUp: cards.filter((c) => c.tier === "coming_up"),
      later: cards.filter((c) => c.tier === "later"),
      recentlyDiscovered: recent.map((i) => toItemCard(i, today)),
      saved: saved.map((i) => toItemCard(i, today)),
      money: await moneySummary(tx, userId, today),
      processing,
      counts: { items: counts?.items ?? 0, documents: counts?.docs ?? 0 },
    };
  });
}

function toItemCard(i: typeof schema.items.$inferSelect, today: string): ItemCard {
  let headline: string | null = null;
  if (i.amountCents != null) headline = formatMoney(i.amountCents, i.currency ?? "USD");
  if (i.primaryDate) {
    const when = i.kind === "purchase" ? `Purchased ${formatDate(i.primaryDate)}` : relativeDays(today, i.primaryDate);
    headline = headline ? `${headline} · ${when}` : when;
  }
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    merchant: i.merchant,
    amountCents: i.amountCents,
    currency: i.currency,
    primaryDate: i.primaryDate,
    needsReview: i.needsReview,
    state: i.state,
    createdAt: i.createdAt,
    possibleDuplicate: !!i.possibleDuplicateOf,
    headline,
  };
}

// ───────────────────────────── Item detail ─────────────────────────────

export async function getItem(userId: string, itemId: string, opts: { now?: Date } = {}) {
  const { today } = await userContext(userId, opts.now);
  return withUser(userId, async (tx) => {
    const [item] = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId)));
    if (!item) throw new NotFoundError();
    const facts = await tx.select().from(schema.itemFacts).where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, itemId))).orderBy(schema.itemFacts.sortOrder);
    const actions = await tx.select().from(schema.actions).where(and(eq(schema.actions.userId, userId), eq(schema.actions.itemId, itemId)));
    const reminders = actions.length
      ? await tx.select().from(schema.reminders).where(and(eq(schema.reminders.userId, userId), inArray(schema.reminders.actionId, actions.map((a) => a.id)))).orderBy(desc(schema.reminders.createdAt))
      : [];
    const protections = await tx.select().from(schema.protections).where(and(eq(schema.protections.userId, userId), eq(schema.protections.itemId, itemId)));
    const outcomes = await tx.select().from(schema.financialOutcomes).where(and(eq(schema.financialOutcomes.userId, userId), eq(schema.financialOutcomes.itemId, itemId)));
    const [document] = item.documentId
      ? await tx
          .select({ id: schema.documents.id, originalFilename: schema.documents.originalFilename, mimeType: schema.documents.mimeType, source: schema.documents.source, createdAt: schema.documents.createdAt })
          .from(schema.documents)
          .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, item.documentId)))
      : [];
    const [purchase] = item.kind === "purchase" ? await tx.select().from(schema.purchases).where(eq(schema.purchases.itemId, itemId)) : [];
    const [duplicateOf] = item.possibleDuplicateOf
      ? await tx.select({ id: schema.items.id, title: schema.items.title }).from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, item.possibleDuplicateOf)))
      : [];
    const pendingByAction = new Map<string, (typeof reminders)[number]>();
    for (const r of reminders) if (r.status === "scheduled" && !pendingByAction.has(r.actionId)) pendingByAction.set(r.actionId, r);
    return {
      today,
      item,
      facts,
      actions: actions
        .map((a) => ({ ...toActionCard(a, item, today, pendingByAction.get(a.id)?.remindAt ?? null), suggestedAction: a.suggestedAction, completedAt: a.completedAt }))
        .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999")),
      reminders,
      protections,
      outcomes,
      document: document ?? null,
      lineItems: purchase?.lineItems ?? [],
      duplicateOf: duplicateOf ?? null,
    };
  });
}

// ───────────────────────────── Edits ─────────────────────────────

export type FactEdit = { valueDate?: string; valueCents?: number; valueText?: string };

const DATE_KEYS = new Set(["purchase_date", "return_deadline", "warranty", "trial_end", "next_renewal", "warranty_end", "expires_on", "start_date"]);
const MONEY_KEYS = new Set(["total", "amount", "purchase_price"]);

/**
 * The user corrects or adds a fact. It becomes confirmed + user_entered, facts
 * computed from it are recomputed, and actions/reminders/protections follow.
 */
export async function editFact(userId: string, itemId: string, key: string, edit: FactEdit, opts: { now?: Date } = {}) {
  const { today, tz } = await userContext(userId, opts.now);
  const isDate = DATE_KEYS.has(key) || /^date_\d+_/.test(key);
  const isMoney = MONEY_KEYS.has(key);
  if (isDate && (!edit.valueDate || !isValidIso(edit.valueDate))) throw new InputError("Enter a valid date.");
  if (isMoney && (edit.valueCents == null || !Number.isInteger(edit.valueCents) || edit.valueCents < 0 || edit.valueCents > 1_000_000_000)) throw new InputError("Enter a valid amount.");
  if (!isDate && !isMoney && (!edit.valueText || edit.valueText.length > 200)) throw new InputError("Enter a value.");

  await withUser(userId, async (tx) => {
    const [item] = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId)));
    if (!item) throw new NotFoundError();
    const facts = await tx.select().from(schema.itemFacts).where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, itemId)));
    const existing = facts.find((f) => f.key === key);
    const now = new Date();
    const patch = {
      valueDate: isDate ? edit.valueDate! : existing?.valueDate ?? null,
      valueCents: isMoney ? edit.valueCents! : existing?.valueCents ?? null,
      valueText: !isDate && !isMoney ? edit.valueText!.trim() : existing?.valueText ?? null,
      certainty: "confirmed" as const,
      basis: "user_entered" as const,
      explanation: "You entered this.",
      confidence: 1,
      userEditedAt: now,
      userConfirmedAt: now,
    };
    if (existing) {
      await tx.update(schema.itemFacts).set(patch).where(eq(schema.itemFacts.id, existing.id));
    } else {
      const label = FACT_LABELS[key];
      if (!label) throw new InputError("That field can't be added here.");
      await tx.insert(schema.itemFacts).values({ userId, itemId, key, label, currency: isMoney ? item.currency ?? "USD" : null, sortOrder: 50, ...patch });
    }

    // Recompute facts derived from a corrected start date.
    if (key === "purchase_date" || key === "start_date") {
      for (const dep of facts) {
        if (dep.userEditedAt || !dep.valueNumber) continue;
        if (dep.key === "return_deadline" && ["computed_from_document", "merchant_policy"].includes(dep.basis)) {
          await tx.update(schema.itemFacts).set({ valueDate: addDays(edit.valueDate!, dep.valueNumber), explanation: recomputedExplanation(dep, edit.valueDate!) }).where(eq(schema.itemFacts.id, dep.id));
        }
        if ((dep.key === "warranty" || dep.key === "warranty_end") && ["computed_from_document", "manufacturer_default"].includes(dep.basis)) {
          await tx.update(schema.itemFacts).set({ valueDate: addMonths(edit.valueDate!, dep.valueNumber), explanation: recomputedExplanation(dep, edit.valueDate!) }).where(eq(schema.itemFacts.id, dep.id));
        }
      }
    }
    if (key === "merchant") await tx.update(schema.items).set({ merchant: edit.valueText!.trim() }).where(eq(schema.items.id, itemId));

    await syncItemFromFacts(tx, userId, itemId, today, tz);
    await audit(tx, { userId, event: "fact.edited", entityType: "item", entityId: itemId, metadata: { key } });
  });
}

const FACT_LABELS: Record<string, string> = {
  return_deadline: "Return window",
  warranty: "Warranty",
  purchase_date: "Purchased",
  total: "Amount",
  amount: "Amount",
  trial_end: "Free trial ends",
  next_renewal: "Renews",
  warranty_end: "Coverage ends",
  expires_on: "Expires",
};

function recomputedExplanation(dep: typeof schema.itemFacts.$inferSelect, start: string) {
  if (dep.key === "return_deadline") {
    return dep.basis === "merchant_policy"
      ? `${dep.valueNumber} days from ${formatDate(start)}, based on the store's typical policy.`
      : `${dep.valueNumber} days from ${formatDate(start)}, as stated on your receipt.`;
  }
  return `${durationText(dep.valueNumber!)} from ${formatDate(start)}.`;
}

/** "Looks right": the user vouches for a fact as shown. */
export async function confirmFact(userId: string, itemId: string, key: string, opts: { now?: Date } = {}) {
  const { today, tz } = await userContext(userId, opts.now);
  await withUser(userId, async (tx) => {
    const [f] = await tx
      .select()
      .from(schema.itemFacts)
      .where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, itemId), eq(schema.itemFacts.key, key)));
    if (!f) throw new NotFoundError();
    if (f.certainty === "unknown") throw new InputError("There's no value to confirm yet. Add it instead.");
    const note = f.basis === "merchant_policy" || f.basis === "manufacturer_default" ? `You confirmed this. ${f.explanation ?? ""}`.trim() : "You confirmed this.";
    await tx.update(schema.itemFacts).set({ certainty: "confirmed", userConfirmedAt: new Date(), explanation: note, confidence: Math.max(f.confidence, 0.95) }).where(eq(schema.itemFacts.id, f.id));
    await syncItemFromFacts(tx, userId, itemId, today, tz);
    await audit(tx, { userId, event: "fact.confirmed", entityType: "item", entityId: itemId, metadata: { key } });
  });
}

/** Item-level "Looks right". */
export async function markItemReviewed(userId: string, itemId: string) {
  await withUser(userId, async (tx) => {
    const res = await tx.update(schema.items).set({ reviewedAt: new Date(), needsReview: false }).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId))).returning({ id: schema.items.id });
    if (!res.length) throw new NotFoundError();
  });
}

export async function setItemState(userId: string, itemId: string, state: ItemState) {
  await withUser(userId, async (tx) => {
    const res = await tx.update(schema.items).set({ state }).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId))).returning({ id: schema.items.id });
    if (!res.length) throw new NotFoundError();
    await audit(tx, { userId, event: `item.${state}`, entityType: "item", entityId: itemId });
  });
}

/** "Not a duplicate": keep both; the item gets its own actions back. */
export async function clearDuplicate(userId: string, itemId: string) {
  const { today, tz } = await userContext(userId);
  await withUser(userId, async (tx) => {
    const res = await tx.update(schema.items).set({ possibleDuplicateOf: null }).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId))).returning({ id: schema.items.id });
    if (!res.length) throw new NotFoundError();
    await syncItemFromFacts(tx, userId, itemId, today, tz);
  });
}

export async function setActionStatus(userId: string, actionId: string, status: ActionStatus, opts: { snoozeDays?: number } = {}) {
  const { today } = await userContext(userId);
  await withUser(userId, async (tx) => {
    const res = await tx
      .update(schema.actions)
      .set({
        status,
        completedAt: status === "done" ? new Date() : null,
        snoozedUntil: status === "snoozed" ? addDays(today, Math.min(Math.max(opts.snoozeDays ?? 1, 1), 30)) : null,
      })
      .where(and(eq(schema.actions.userId, userId), eq(schema.actions.id, actionId)))
      .returning({ id: schema.actions.id, protectionId: schema.actions.protectionId });
    if (!res.length) throw new NotFoundError();
    if (status === "done" || status === "dismissed") {
      await tx.update(schema.reminders).set({ status: "cancelled" }).where(and(eq(schema.reminders.userId, userId), eq(schema.reminders.actionId, actionId), eq(schema.reminders.status, "scheduled")));
    }
    await audit(tx, { userId, event: `action.${status}`, entityType: "action", entityId: actionId });
  });
}

/**
 * Money Saved only ever comes from here: the user tells us what actually
 * happened ("I returned it and got $1,299 back").
 */
export async function recordOutcome(userId: string, input: { itemId: string; kind: OutcomeKind; amountCents: number; note?: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 1_000_000_000) throw new InputError("Enter a valid amount.");
  await withUser(userId, async (tx) => {
    const [item] = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, input.itemId)));
    if (!item) throw new NotFoundError();
    const protectionKind = input.kind === "credit_used" ? "travel_credit" : input.kind === "warranty_claim_paid" ? "warranty" : input.kind === "return_completed" || input.kind === "refund_received" ? "return_window" : null;
    const [prot] = protectionKind
      ? await tx.select().from(schema.protections).where(and(eq(schema.protections.userId, userId), eq(schema.protections.itemId, item.id), eq(schema.protections.kind, protectionKind)))
      : [];
    await tx.insert(schema.financialOutcomes).values({
      userId,
      itemId: item.id,
      protectionId: prot?.id ?? null,
      kind: input.kind,
      amountCents: input.amountCents,
      currency: item.currency ?? "USD",
      note: input.note?.slice(0, 280) ?? null,
      confirmedByUserAt: new Date(),
    });
    if (prot) await tx.update(schema.protections).set({ status: "used" }).where(eq(schema.protections.id, prot.id));
    await audit(tx, { userId, event: "outcome.recorded", entityType: "item", entityId: item.id, metadata: { kind: input.kind } });
  });
}

/** Delete an item (and its facts/actions/reminders) without deleting the source document. */
export async function deleteItem(userId: string, itemId: string) {
  await withUser(userId, async (tx) => {
    const res = await tx.delete(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId))).returning({ id: schema.items.id });
    if (!res.length) throw new NotFoundError();
    await audit(tx, { userId, event: "item.deleted", entityType: "item", entityId: itemId });
  });
}

// ───────────────────────────── The reveal ─────────────────────────────

export type Discovery = {
  itemId: string;
  kind: "purchase" | "deadline" | "warranty" | "subscription" | "credit" | "money" | "document" | "unknown";
  label: string;
  value: string;
  detail: string | null;
  certainty: Certainty | null;
  factKey: string | null;
  actionId: string | null;
  documentId?: string | null;
  raw?: { valueDate: string | null; valueCents: number | null; valueText: string | null } | null;
};

/**
 * "We found N things worth knowing." Built only from stored, verified facts.
 * Unknowns are shown (honesty) but not counted as findings.
 */
export async function getDiscoveries(userId: string, documentIds: string[], opts: { now?: Date } = {}) {
  const { today } = await userContext(userId, opts.now);
  return withUser(userId, async (tx) => {
    if (!documentIds.length) return { found: [] as Discovery[], unknowns: [] as Discovery[], moneyTrackedCents: 0, currency: "USD", documents: [] };
    const docs = await tx
      .select({ id: schema.documents.id, status: schema.documents.status, stage: schema.documents.stage, failureReason: schema.documents.failureReason, originalFilename: schema.documents.originalFilename, processingMs: schema.documents.processingMs })
      .from(schema.documents)
      .where(and(eq(schema.documents.userId, userId), inArray(schema.documents.id, documentIds)));
    const items = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), inArray(schema.items.documentId, documentIds)));
    const found: Discovery[] = [];
    const unknowns: Discovery[] = [];
    let moneyTracked = 0;
    let currency = "USD";

    for (const it of items) {
      const facts = await tx.select().from(schema.itemFacts).where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, it.id))).orderBy(schema.itemFacts.sortOrder);
      const acts = await tx.select().from(schema.actions).where(and(eq(schema.actions.userId, userId), eq(schema.actions.itemId, it.id)));
      const prots = await tx.select().from(schema.protections).where(and(eq(schema.protections.userId, userId), eq(schema.protections.itemId, it.id), eq(schema.protections.status, "active")));
      const f = (k: string) => facts.find((x) => x.key === k);
      const actionFor = (t: string) => acts.find((a) => a.type === t)?.id ?? null;
      const money = (cents: number | null | undefined, cur?: string | null) => formatMoney(cents ?? null, cur ?? it.currency ?? "USD");
      const push = (d: Omit<Discovery, "itemId">) => {
        const fx = d.factKey ? f(d.factKey) : undefined;
        const raw = fx ? { valueDate: fx.valueDate, valueCents: fx.valueCents, valueText: fx.valueText } : null;
        (d.certainty === "unknown" ? unknowns : found).push({ itemId: it.id, documentId: it.documentId, raw, ...d });
      };
      const dateLine = (fact: typeof facts[number]) => {
        if (!fact.valueDate) return "";
        const d = daysBetween(today, fact.valueDate);
        const rel = d < 0 ? `ended ${formatDate(fact.valueDate)}` : d === 0 ? "ends today" : `${d} day${d === 1 ? "" : "s"} remaining`;
        return fact.certainty === "estimated" ? `Estimated: ${rel}` : rel.charAt(0).toUpperCase() + rel.slice(1);
      };

      if (it.possibleDuplicateOf) {
        found.push({ itemId: it.id, kind: "document", label: "Already tracking this", value: it.title, detail: "This looks like a purchase you already added, so we didn't create new reminders.", certainty: null, factKey: null, actionId: null });
        continue;
      }

      switch (it.kind) {
        case "purchase": {
          const total = f("total");
          const merchant = f("merchant");
          const pd = f("purchase_date");
          push({
            kind: "purchase",
            label: merchant?.valueText ? `Purchase · ${merchant.valueText}` : "Purchase",
            value: it.title,
            detail: [total?.valueCents != null ? `${money(total.valueCents, total.currency)} total` : "Amount unknown", pd?.valueDate ? `Purchased ${formatDate(pd.valueDate)}` : null].filter(Boolean).join(" · "),
            certainty: total?.certainty ?? "unknown",
            factKey: "total",
            actionId: null,
          });
          const ret = f("return_deadline");
          if (ret) push({ kind: ret.certainty === "unknown" ? "unknown" : "deadline", label: "Return window", value: ret.certainty === "unknown" ? "Unknown" : dateLine(ret), detail: ret.explanation, certainty: ret.certainty, factKey: "return_deadline", actionId: actionFor("return") });
          const war = f("warranty");
          if (war && war.certainty !== "unknown") push({ kind: "warranty", label: "Warranty", value: war.valueNumber ? durationText(war.valueNumber) : war.valueDate ? `Until ${formatDate(war.valueDate)}` : "Covered", detail: war.explanation, certainty: war.certainty, factKey: "warranty", actionId: actionFor("warranty_expiring") });
          break;
        }
        case "subscription": {
          const amount = f("amount");
          const trial = f("trial_end");
          const renew = f("next_renewal");
          const period = f("billing_period")?.valueText;
          push({ kind: "subscription", label: "Subscription", value: `${it.title}${amount?.valueCents != null ? ` · ${money(amount.valueCents, amount.currency)}${period === "monthly" ? "/month" : period === "annual" ? "/year" : ""}` : ""}`, detail: null, certainty: amount?.certainty ?? "unknown", factKey: "amount", actionId: null });
          const key = trial?.valueDate ? trial : renew;
          if (key) push({ kind: key.certainty === "unknown" ? "unknown" : "deadline", label: trial?.valueDate ? "Free trial ends" : "Renews", value: key.certainty === "unknown" ? "Unknown" : `${relativeDays(today, key.valueDate!)} · ${formatDate(key.valueDate!)}`, detail: key.explanation, certainty: key.certainty, factKey: key.key, actionId: actionFor(trial?.valueDate ? "cancel_trial" : "review_renewal") });
          break;
        }
        case "travel_credit": {
          const amount = f("amount");
          const exp = f("expires_on");
          push({ kind: "credit", label: "Travel credit", value: `${money(amount?.valueCents, amount?.currency)}${it.merchant ? ` · ${it.merchant}` : ""}`, detail: null, certainty: amount?.certainty ?? "unknown", factKey: "amount", actionId: null });
          if (exp) push({ kind: exp.certainty === "unknown" ? "unknown" : "deadline", label: exp.label, value: exp.certainty === "unknown" ? "Unknown" : `${formatDate(exp.valueDate!)} · ${relativeDays(today, exp.valueDate!)}`, detail: exp.explanation, certainty: exp.certainty, factKey: "expires_on", actionId: actionFor("use_credit") });
          break;
        }
        case "warranty": {
          const end = f("warranty_end");
          if (end) push({ kind: end.certainty === "unknown" ? "unknown" : "warranty", label: "Warranty", value: end.certainty === "unknown" ? "End date unknown" : `Until ${formatDate(end.valueDate!)}`, detail: end.explanation, certainty: end.certainty, factKey: "warranty_end", actionId: actionFor("warranty_expiring") });
          break;
        }
        case "document":
          found.push({ itemId: it.id, kind: "document", label: "Saved document", value: it.title, detail: "We didn't find any deadlines in this one. It's saved and searchable.", certainty: null, factKey: null, actionId: null });
          break;
        default: {
          for (const fact of facts.filter((x) => x.valueDate)) {
            push({ kind: "deadline", label: fact.label, value: `${formatDate(fact.valueDate!)} · ${relativeDays(today, fact.valueDate!)}`, detail: fact.explanation, certainty: fact.certainty, factKey: fact.key, actionId: acts[0]?.id ?? null });
          }
        }
      }
      const maxProt = prots.filter((p) => p.certainty !== "unknown" && p.activeUntil && p.activeUntil >= today).reduce((m, p) => Math.max(m, p.amountCents), 0);
      if (maxProt > 0) {
        moneyTracked += maxProt;
        currency = prots[0]!.currency;
      }
    }
    if (moneyTracked > 0) {
      found.push({ itemId: items[0]!.id, kind: "money", label: "Money protected", value: formatMoney(moneyTracked, currency), detail: "The value of purchases and credits with an open window we're now tracking. This isn't money saved.", certainty: null, factKey: null, actionId: null });
    }
    return { found, unknowns, moneyTrackedCents: moneyTracked, currency, documents: docs };
  });
}

// ───────────────────────────── Re-prioritization (worker) ─────────────────────────────

export async function reprioritizeUser(userId: string, opts: { now?: Date } = {}) {
  const { today } = await userContext(userId, opts.now);
  await withUser(userId, async (tx) => {
    const rows = await tx
      .select({ action: schema.actions, importance: schema.items.userImportance })
      .from(schema.actions)
      .innerJoin(schema.items, eq(schema.items.id, schema.actions.itemId))
      .where(and(eq(schema.actions.userId, userId), inArray(schema.actions.status, ["open", "snoozed"])));
    for (const r of rows) {
      const p = { ...r.action, userImportance: r.importance };
      await tx.update(schema.actions).set({ priorityScore: priorityScore(p, today), priorityReason: priorityReason(p, today) }).where(eq(schema.actions.id, r.action.id));
    }
    // Windows that have closed stop counting toward Money Protected.
    await tx
      .update(schema.protections)
      .set({ status: "expired" })
      .where(and(eq(schema.protections.userId, userId), eq(schema.protections.status, "active"), sql`${schema.protections.activeUntil} < ${today}`));
  });
}
