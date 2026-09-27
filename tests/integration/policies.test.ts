import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "@/server/ai/provider";
import { env, resetEnvCache } from "@/server/env";
import { applyPolicyLookups } from "@/server/policies/apply";
import { lookupPolicy } from "@/server/policies/lookup";
import { editFact, getItem } from "@/server/services/items";
import { createManualPurchase } from "@/server/services/manual";
import { adminPool, createUser, resetDb } from "../helpers/db";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function factsOf(userId: string, itemId: string) {
  const { facts, item } = await getItem(userId, itemId);
  return { item, f: (k: string) => facts.find((x) => x.key === k) };
}

describe("web policy lookups", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.POLICY_LOOKUP_DAILY_LIMIT;
    resetEnvCache();
  });

  it("fills in a return window and warranty for a purchase with no receipt", async () => {
    const u = await createUser();
    const id = await createManualPurchase(u.id, { item: "Brightline 55-inch TV", store: "Gadget Barn", purchaseDate: daysAgo(3), dateCertainty: "exact", priceCents: 49999 });
    const { f, item } = await factsOf(u.id, id);

    const ret = f("return_deadline")!;
    expect(ret).toMatchObject({ certainty: "estimated", basis: "merchant_policy", valueNumber: 14, sourceUrl: "https://www.gadgetbarn.example/help/returns" });
    expect(ret.valueDate).toBe(new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10));
    expect(ret.evidence).toMatch(/Electronics.*14 days/);
    expect(ret.explanation).toMatch(/Gadget Barn's return policy page/);

    const war = f("warranty")!;
    expect(war).toMatchObject({ certainty: "estimated", basis: "manufacturer_default", valueNumber: 24, sourceUrl: "https://brightline.example/support/warranty" });
    expect(f("purchase_date")).toMatchObject({ certainty: "confirmed", basis: "user_entered" });
    expect(item.details.policyLookup).toMatchObject({ status: "done", return: "found", warranty: "found" });
  });

  it("shows the policy without inventing a deadline when the date is unknown, then fills it in", async () => {
    const u = await createUser();
    const id = await createManualPurchase(u.id, { item: "Brightline soundbar", store: "Gadget Barn", purchaseDate: null, dateCertainty: "unknown", priceCents: null });
    let { f } = await factsOf(u.id, id);
    expect(f("return_deadline")).toMatchObject({ certainty: "unknown", valueNumber: 14, valueDate: null });
    expect(f("return_deadline")!.explanation).toMatch(/Add your purchase date/);

    await editFact(u.id, id, "purchase_date", { valueDate: daysAgo(2) });
    ({ f } = await factsOf(u.id, id));
    expect(f("return_deadline")).toMatchObject({ certainty: "estimated", valueDate: new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10) });
    expect(f("warranty")!.certainty).toBe("estimated");
  });

  it("says so when a policy can't be found, and uses the reviewed store list without a web lookup", async () => {
    const u = await createUser();
    const spy = vi.spyOn(await getProvider(), "researchPolicy");
    const unknown = await createManualPurchase(u.id, { item: "Ceramic vase", store: "Corner Shop", purchaseDate: daysAgo(1), dateCertainty: "approx", priceCents: 2500 });
    expect((await factsOf(u.id, unknown)).f("return_deadline")).toMatchObject({ certainty: "unknown", explanation: expect.stringMatching(/couldn't find Corner Shop's return policy/) });
    expect(spy).toHaveBeenCalledTimes(1);

    const curated = await createManualPurchase(u.id, { item: "Throw pillow", store: "Target", purchaseDate: daysAgo(1), dateCertainty: "exact", priceCents: 1999 });
    expect((await factsOf(u.id, curated)).f("return_deadline")).toMatchObject({ certainty: "estimated", basis: "merchant_policy", sourceUrl: null });
    expect(spy).toHaveBeenCalledTimes(1); // no web lookup for a store we already know
  });

  it("never overrides a date from the document or the user", async () => {
    const u = await createUser();
    const id = await createManualPurchase(u.id, { item: "Brightline TV", store: "Gadget Barn", purchaseDate: daysAgo(3), dateCertainty: "exact", priceCents: null });
    await editFact(u.id, id, "return_deadline", { valueDate: daysAgo(-40) });
    await adminPool().query(`update item_facts set basis = 'none' where item_id = $1 and key = 'return_deadline'`, [id]);
    await applyPolicyLookups(u.id, id);
    expect((await factsOf(u.id, id)).f("return_deadline")!.valueDate).toBe(daysAgo(-40));
  });

  it("caches results across users and only sends public details to the web", async () => {
    const provider = await getProvider();
    const spy = vi.spyOn(provider, "researchPolicy");
    const a = await createUser({ name: "Alice Private" });
    const b = await createUser();
    await createManualPurchase(a.id, { item: "Brightline TV SN8842119934", store: "Gadget Barn", purchaseDate: daysAgo(1), dateCertainty: "exact", priceCents: 50000 });
    await createManualPurchase(b.id, { item: "Brightline TV", store: "gadget barn", purchaseDate: daysAgo(1), dateCertainty: "exact", priceCents: null });
    // One return + one warranty lookup in total; the second user hits the cache.
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [q] of spy.mock.calls) {
      expect(Object.keys(q).sort()).toEqual(["category", "kind", "productHint", "subject"]);
      expect(JSON.stringify(q)).not.toMatch(/Alice|example\.com|8842119934|50000/);
    }
    const { rows } = await adminPool().query(`select key, status from policy_lookups order by key`);
    expect(rows).toEqual([
      { key: "return|gadget barn|electronics", status: "found" },
      { key: "warranty|brightline|tv", status: "found" },
    ]);
  });

  it("stops making new lookups when the daily budget is used up", async () => {
    process.env.POLICY_LOOKUP_DAILY_LIMIT = "0";
    resetEnvCache();
    expect(env().POLICY_LOOKUP_DAILY_LIMIT).toBe(0);
    const r = await lookupPolicy({ kind: "return", subject: "Gadget Barn", category: "general", productHint: null });
    expect(r.status).toBe("over_budget");
  });
});
