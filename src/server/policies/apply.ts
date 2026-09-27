import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { schema, withUser, type Tx } from "@/server/db/client";
import { durationText } from "@/server/derivation/derive";
import { addDays, addMonths, formatDate } from "@/server/extraction/dates";
import { syncItemFromFacts } from "@/server/services/sync";
import { userContext } from "@/server/services/items";
import { brandOf, lookupPolicy, productHint, returnCategory, warrantyCategory, type LookupOutcome } from "./lookup";

/**
 * Fill in a purchase's missing return window / warranty from the store's and
 * manufacturer's public policy pages. Never overrides anything printed on the
 * document or entered by the user; results are always "estimated".
 */

type Fact = typeof schema.itemFacts.$inferSelect;
export type PolicyLookupState = { status: "pending" | "done"; return?: string; warranty?: string; merchant?: string; brand?: string };

function replaceable(f: Fact | undefined) {
  return !f || (f.basis === "none" && !f.userEditedAt);
}

async function loadPlan(userId: string, itemId: string) {
  return withUser(userId, async (tx) => {
    const [item] = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId)));
    if (!item || item.kind !== "purchase" || item.state !== "active") return null;
    const facts = await tx.select().from(schema.itemFacts).where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, itemId)));
    const [p] = await tx.select({ lineItems: schema.purchases.lineItems }).from(schema.purchases).where(eq(schema.purchases.itemId, itemId));
    const names = [item.title, ...(p?.lineItems ?? []).map((l) => l.name)].filter(Boolean);
    const get = (k: string) => facts.find((f) => f.key === k);
    const merchant = item.merchant?.trim() || null;
    const wCat = warrantyCategory(names);
    const brand = brandOf(names);
    return {
      item,
      names,
      merchant,
      brand,
      wantReturn: !!merchant && replaceable(get("return_deadline")),
      wantWarranty: !!wCat && !!brand && replaceable(get("warranty")),
      rCat: returnCategory(names),
      wCat,
    };
  });
}

/** Cheap check used by the pipeline before enqueuing a lookup job. */
export async function needsPolicyLookup(userId: string, itemId: string) {
  const plan = await loadPlan(userId, itemId);
  return !!plan && (plan.wantReturn || plan.wantWarranty);
}

async function setState(tx: Tx, itemId: string, details: Record<string, unknown>, state: PolicyLookupState) {
  await tx.update(schema.items).set({ details: { ...details, policyLookup: state } }).where(eq(schema.items.id, itemId));
}

export async function applyPolicyLookups(userId: string, itemId: string, opts: { now?: Date } = {}) {
  const plan = await loadPlan(userId, itemId);
  if (!plan || (!plan.wantReturn && !plan.wantWarranty)) return null;
  const hint = productHint(plan.item.title);

  await withUser(userId, (tx) => setState(tx, itemId, plan.item.details, { status: "pending", merchant: plan.merchant ?? undefined, brand: plan.brand ?? undefined }));

  const [ret, war] = await Promise.all([
    plan.wantReturn ? lookupPolicy({ kind: "return", subject: plan.merchant!, category: plan.rCat, productHint: hint }, opts) : null,
    plan.wantWarranty ? lookupPolicy({ kind: "warranty", subject: plan.brand!, category: plan.wCat!, productHint: hint }, opts) : null,
  ]);

  const { today, tz } = await userContext(userId, opts.now);
  await withUser(userId, async (tx) => {
    const [item] = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.id, itemId)));
    if (!item) return;
    const facts = await tx.select().from(schema.itemFacts).where(and(eq(schema.itemFacts.userId, userId), eq(schema.itemFacts.itemId, itemId)));
    const get = (k: string) => facts.find((f) => f.key === k);
    const pd = get("purchase_date");
    const purchaseDate = pd?.valueDate && pd.certainty !== "unknown" ? pd.valueDate : null;

    if (ret && replaceable(get("return_deadline"))) await writeReturn(tx, userId, itemId, get("return_deadline"), ret, plan.merchant!, purchaseDate, pd?.confidence ?? 0);
    if (war && replaceable(get("warranty"))) await writeWarranty(tx, userId, itemId, get("warranty"), war, plan.brand!, purchaseDate, pd?.confidence ?? 0);

    await syncItemFromFacts(tx, userId, itemId, today, tz);
    await setState(tx, itemId, item.details, { status: "done", return: ret?.status, warranty: war?.status, merchant: plan.merchant ?? undefined, brand: plan.brand ?? undefined });
    await audit(tx, { userId, actor: "worker", event: "item.policy_lookup", entityType: "item", entityId: itemId, metadata: { return: ret?.status ?? null, warranty: war?.status ?? null } });
  });
  return { return: ret, warranty: war };
}

function notes(r: { categoryNote: string | null; membershipNote: string | null }) {
  return [r.categoryNote, r.membershipNote].filter(Boolean).join(". ");
}

async function upsertFact(tx: Tx, userId: string, itemId: string, existing: Fact | undefined, values: Partial<typeof schema.itemFacts.$inferInsert> & { key: string; label: string }) {
  if (existing) await tx.update(schema.itemFacts).set(values).where(eq(schema.itemFacts.id, existing.id));
  else await tx.insert(schema.itemFacts).values({ userId, itemId, sortOrder: 40, certainty: "unknown", basis: "none", confidence: 0, ...values });
}

async function writeReturn(tx: Tx, userId: string, itemId: string, existing: Fact | undefined, out: LookupOutcome, merchant: string, purchaseDate: string | null, pdConfidence: number) {
  if (out.status !== "found") {
    if (out.status === "not_found") {
      await upsertFact(tx, userId, itemId, existing, {
        key: "return_deadline",
        label: "Return window",
        certainty: "unknown",
        basis: "none",
        confidence: 0,
        explanation: `We couldn't find ${merchant}'s return policy online. If you know it, add the deadline.`,
      });
    }
    return;
  }
  const r = out.result;
  const checked = formatDate(out.checkedAt.toISOString().slice(0, 10), { withYear: true });
  const extra = notes(r);
  const fromDelivery = r.startsFrom === "delivery" ? " The window starts at delivery; we count from your purchase date so you act early." : "";
  await upsertFact(tx, userId, itemId, existing, {
    key: "return_deadline",
    label: "Return window",
    valueNumber: r.value,
    valueDate: purchaseDate ? addDays(purchaseDate, r.value) : null,
    certainty: purchaseDate ? "estimated" : "unknown",
    basis: "merchant_policy",
    evidence: r.quote,
    sourceUrl: r.sourceUrl,
    confidence: purchaseDate ? Math.min(0.6, pdConfidence) : 0,
    explanation: purchaseDate
      ? `Based on ${merchant}'s return policy page (checked ${checked}): ${r.value} days.${extra ? ` ${extra}.` : ""}${fromDelivery} Your receipt doesn't say.`
      : `${merchant} allows ${r.value} days for returns (checked ${checked}).${extra ? ` ${extra}.` : ""} Add your purchase date to see your deadline.`,
  });
}

async function writeWarranty(tx: Tx, userId: string, itemId: string, existing: Fact | undefined, out: LookupOutcome, brand: string, purchaseDate: string | null, pdConfidence: number) {
  if (out.status !== "found") return; // no fact at all is clearer than "unknown warranty"
  const r = out.result;
  const checked = formatDate(out.checkedAt.toISOString().slice(0, 10), { withYear: true });
  await upsertFact(tx, userId, itemId, existing, {
    key: "warranty",
    label: "Warranty",
    valueNumber: r.value,
    valueDate: purchaseDate ? addMonths(purchaseDate, r.value) : null,
    certainty: purchaseDate ? "estimated" : "unknown",
    basis: "manufacturer_default",
    evidence: r.quote,
    sourceUrl: r.sourceUrl,
    confidence: purchaseDate ? Math.min(0.55, pdConfidence) : 0,
    explanation: `Based on ${brand}'s warranty page (checked ${checked}): ${durationText(r.value)}${r.coverageNote ? `, ${r.coverageNote.toLowerCase()}` : ""}.${purchaseDate ? " Your receipt doesn't mention a warranty." : " Add your purchase date to see when it ends."}`,
  });
}
