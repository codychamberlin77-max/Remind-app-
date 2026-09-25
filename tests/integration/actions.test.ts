import { beforeEach, describe, expect, it } from "vitest";
import { setClock } from "@/server/clock";
import { addDays, todayIn } from "@/server/extraction/dates";
import { ingest } from "@/server/ingestion/ingest";
import { buildSample } from "@/server/samples";
import { confirmFact, editFact, getDashboard, getItem, recordOutcome, setActionStatus } from "@/server/services/items";
import { createReminder, dispatchDueReminders, listNotifications, listReminders, resolveRemindDate, zonedInstant } from "@/server/services/reminders";
import { search, parseQuery } from "@/server/services/search";
import { adminPool, createUser, resetDb } from "../helpers/db";

async function seed(userId: string, id: "receipt" | "trial" | "credit" = "receipt") {
  const s = await buildSample(id, todayIn("America/New_York"));
  const r = await ingest({ userId, source: "upload", bytes: s.bytes, filename: s.filename });
  if (r.status !== "accepted") throw new Error(r.status);
  return r.documentId;
}

describe("reminders", () => {
  beforeEach(resetDb);

  it("resolves presets in the user's timezone and never schedules in the past", () => {
    expect(resolveRemindDate("3_days_before", "2026-09-25", "2026-10-07")).toBe("2026-10-04");
    expect(resolveRemindDate("1_week_before", "2026-09-25", "2026-09-28")).toBe("2026-09-25");
    expect(() => resolveRemindDate("custom", "2026-09-25", null, "2026-09-01")).toThrow();
    expect(zonedInstant("2026-10-04", 9, "America/New_York").toISOString()).toBe("2026-10-04T13:00:00.000Z");
    expect(zonedInstant("2026-12-04", 9, "America/New_York").toISOString()).toBe("2026-12-04T14:00:00.000Z");
  });

  it("creates, replaces, and delivers reminders in-app and by email", async () => {
    const u = await createUser();
    await seed(u.id);
    const dash = await getDashboard(u.id);
    const a = dash.needsAttention[0]!;
    await createReminder(u.id, { actionId: a.actionId, preset: "3_days_before" });
    const r2 = await createReminder(u.id, { actionId: a.actionId, preset: "tomorrow" });
    const list = await listReminders(u.id);
    expect(list.filter((r) => r.status === "scheduled")).toHaveLength(1);

    // Deliver: move the reminder into the past.
    // Test setup via the admin connection (the app role can't touch rows without a user context).
    await adminPool().query(`update reminders set remind_at = now() - interval '1 minute' where id = $1`, [r2.id]);
    const res = await dispatchDueReminders();
    expect(res.sent).toBe(1);
    const notes = await listNotifications(u.id);
    expect(notes[0]!.title).toMatch(/Return window/);
    expect(notes[0]!.body).toMatch(/\(estimated\)/);
    expect((await listReminders(u.id)).find((r) => r.id === r2.id)!.status).toBe("sent");
    // Nothing left to send.
    expect((await dispatchDueReminders()).sent).toBe(0);
  });

  it("does not remind about completed actions", async () => {
    const u = await createUser();
    await seed(u.id);
    const a = (await getDashboard(u.id)).needsAttention[0]!;
    const r = await createReminder(u.id, { actionId: a.actionId, preset: "tomorrow" });
    await setActionStatus(u.id, a.actionId, "done");
    await adminPool().query(`update reminders set remind_at = now() - interval '1 minute', status = 'scheduled' where id = $1`, [r.id]);
    await dispatchDueReminders();
    expect(await listNotifications(u.id)).toHaveLength(0);
  });
});

describe("edits and confirmations", () => {
  beforeEach(resetDb);

  it("correcting the purchase date recomputes estimated deadlines and moves reminders", async () => {
    const u = await createUser();
    const today = todayIn(u.timezone);
    await seed(u.id);
    const a = (await getDashboard(u.id)).needsAttention.find((c) => c.type === "return")!;
    await createReminder(u.id, { actionId: a.actionId, preset: "3_days_before" });

    await editFact(u.id, a.itemId, "purchase_date", { valueDate: addDays(today, -1) });
    const item = await getItem(u.id, a.itemId);
    const ret = item.facts.find((f) => f.key === "return_deadline")!;
    expect(ret.valueDate).toBe(addDays(today, 14));
    expect(ret.certainty).toBe("estimated"); // still a policy estimate
    const action = item.actions.find((x) => x.type === "return")!;
    expect(action.dueOn).toBe(addDays(today, 14));
    const rem = (await listReminders(u.id)).find((r) => r.status === "scheduled")!;
    expect(rem.remindAt.toISOString().slice(0, 10)).toBe(addDays(today, 11));
  });

  it("'Looks right' confirms an estimate; Money Saved only comes from user-confirmed outcomes", async () => {
    const u = await createUser();
    await seed(u.id);
    const a = (await getDashboard(u.id)).needsAttention[0]!;
    expect((await getDashboard(u.id)).money.savedCents).toBe(0);
    await confirmFact(u.id, a.itemId, "return_deadline");
    const item = await getItem(u.id, a.itemId);
    expect(item.facts.find((f) => f.key === "return_deadline")!.certainty).toBe("confirmed");
    expect(item.actions.find((x) => x.type === "return")!.dueCertainty).toBe("confirmed");

    await recordOutcome(u.id, { itemId: a.itemId, kind: "return_completed", amountCents: 161133 });
    const dash = await getDashboard(u.id);
    expect(dash.money.savedCents).toBe(161133);
    // The used return window no longer counts; the warranty protection remains.
    expect(dash.money.protectedCents).toBe(129999);
  });

  it("adding an unknown fact creates the missing action", async () => {
    const u = await createUser();
    const bytes = Buffer.from("SAM'S BIKES\nSep 19, 2026\n\nHelmet 69.99\nTOTAL 69.99\n");
    const r = await ingest({ userId: u.id, source: "upload", bytes, filename: "bike.txt" });
    expect(r.status).toBe("accepted");
    // No recording → filed as a document with no actions (honest "we don't know").
    expect((await getDashboard(u.id)).needsAttention).toHaveLength(0);
  });
});

describe("search", () => {
  beforeEach(resetDb);

  it("parses common questions into structured plans", () => {
    const p = parseQuery("Show me everything I bought at Best Buy.", "2026-09-25", ["Best Buy", "Delta Air Lines"]);
    expect(p.merchant).toBe("Best Buy");
    expect(p.kinds).toContain("purchase");
    expect(parseQuery("What expires this month?", "2026-09-25", []).range).toEqual({ from: "2026-09-25", to: "2026-09-30", label: "this month" });
    expect(parseQuery("Which purchases have warranties?", "2026-09-25", []).withWarranty).toBe(true);
    expect(parseQuery("How much money do I have in active warranties?", "2026-09-25", []).aggregate).toBe("warranty_value");
    expect(parseQuery("How much am I currently tracking?", "2026-09-25", []).aggregate).toBe("money_protected");
  });

  it("answers over structured data", async () => {
    const u = await createUser();
    setClock(null);
    await seed(u.id);
    await seed(u.id, "credit");
    await seed(u.id, "trial");
    const bb = await search(u.id, "Show me everything I bought at Best Buy");
    expect(bb.results.map((r) => r.title)).toEqual(['Samsung 65" Class Q80D QLED 4K TV']);
    const w = await search(u.id, "Which purchases have warranties?");
    expect(w.results).toHaveLength(1);
    const tracking = await search(u.id, "How much am I currently tracking?");
    expect(tracking.total!.cents).toBe(161133 + 43100);
    const soon = await search(u.id, "What's coming up?");
    expect(soon.results.some((r) => /Free trial ends/.test(r.title))).toBe(true);
    const text = await search(u.id, "geek squad");
    expect(text.documents.length).toBe(1);
  });
});
