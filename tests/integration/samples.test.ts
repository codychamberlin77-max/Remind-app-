import { beforeEach, describe, expect, it } from "vitest";
import { ingest } from "@/server/ingestion/ingest";
import { todayIn, addDays, addMonths } from "@/server/extraction/dates";
import { buildSample } from "@/server/samples";
import { getDashboard, getDiscoveries, getItem } from "@/server/services/items";
import { getDocument } from "@/server/services/documents";
import { createUser, resetDb } from "../helpers/db";

describe("first-run samples (end to end)", () => {
  beforeEach(resetDb);

  it("receipt: finds purchase, estimated return window, stated warranty, and money protected", async () => {
    const u = await createUser();
    const today = todayIn(u.timezone);
    const s = await buildSample("receipt", today);
    const res = await ingest({ userId: u.id, source: "sample", bytes: s.bytes, filename: s.filename });
    expect(res.status).toBe("accepted");
    if (res.status !== "accepted") return;

    const doc = await getDocument(u.id, res.documentId);
    expect(doc.status).toBe("processed");

    const disc = await getDiscoveries(u.id, [res.documentId]);
    const labels = disc.found.map((d) => d.label);
    expect(labels).toEqual(["Purchase · Best Buy", "Return window", "Warranty", "Money protected"]);
    const ret = disc.found.find((d) => d.label === "Return window")!;
    expect(ret.certainty).toBe("estimated");
    expect(ret.value).toBe("Estimated: 12 days remaining");
    expect(ret.detail).toMatch(/Best Buy's typical 15-day return policy/);
    const war = disc.found.find((d) => d.label === "Warranty")!;
    expect(war.certainty).toBe("confirmed");
    expect(war.value).toBe("2 years");
    expect(disc.moneyTrackedCents).toBe(161133);

    const dash = await getDashboard(u.id);
    const action = [...dash.needsAttention, ...dash.comingUp].find((a) => a.type === "return")!;
    expect(action.dueOn).toBe(addDays(today, 12));
    expect(action.dueCertainty).toBe("estimated");
    expect(action.reason).toMatch(/likely closes in 12 days \(estimated\)/);
    expect(dash.money.protectedCents).toBe(161133);

    const detail = await getItem(u.id, action.itemId);
    expect(detail.item.title).toBe('Samsung 65" Class Q80D QLED 4K TV');
    const warFact = detail.facts.find((f) => f.key === "warranty")!;
    expect(warFact.valueDate).toBe(addMonths(addDays(today, -3), 24));
  });

  it("trial email: weekday-only date resolved against the sent date", async () => {
    const u = await createUser();
    const today = todayIn(u.timezone);
    const s = await buildSample("trial", today);
    const res = await ingest({ userId: u.id, source: "sample", bytes: s.bytes, filename: s.filename });
    if (res.status !== "accepted") throw new Error(res.status);
    const dash = await getDashboard(u.id);
    const a = dash.needsAttention.find((c) => c.type === "cancel_trial")!;
    expect(a).toBeTruthy();
    expect(a.dueOn).toBe(addDays(today, 2));
    expect(a.dueCertainty).toBe("confirmed");
    expect(a.reason).toBe("Your free trial becomes a $19.99 charge in 2 days.");
  });

  it("airline credit: amount, travel-by date, encrypted code", async () => {
    const u = await createUser();
    const today = todayIn(u.timezone);
    const s = await buildSample("credit", today);
    const res = await ingest({ userId: u.id, source: "sample", bytes: s.bytes, filename: s.filename });
    if (res.status !== "accepted") throw new Error(res.status);
    const disc = await getDiscoveries(u.id, [res.documentId]);
    expect(disc.found.map((d) => d.label)).toEqual(["Travel credit", "Travel by", "Money protected"]);
    expect(disc.moneyTrackedCents).toBe(43100);
    const doc = await getItem(u.id, disc.found[0]!.itemId);
    const code = doc.facts.find((f) => f.key === "credit_code")!;
    expect(code.valueText).toBe("•••• 3516");
  });
});
