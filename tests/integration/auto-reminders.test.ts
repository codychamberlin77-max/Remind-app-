import { beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/server/extraction/dates";
import { createManualPurchase } from "@/server/services/manual";
import { getDashboard, setActionStatus } from "@/server/services/items";
import { cancelReminder, dispatchDueReminders, listNotifications, listReminders, updatePreferences } from "@/server/services/reminders";
import { adminPool, createUser, resetDb } from "../helpers/db";

/** A Target purchase `daysAgo` days ago: Target's reviewed 90-day policy gives a known deadline. */
async function purchase(userId: string, daysAgo: number, tz = "America/New_York") {
  const today = todayIn(tz);
  const itemId = await createManualPurchase(userId, { item: "Throw pillow", store: "Target", purchaseDate: addDays(today, -daysAgo), dateCertainty: "exact", priceCents: 2000 });
  const action = (await getDashboard(userId)).needsAttention.concat((await getDashboard(userId)).comingUp, (await getDashboard(userId)).later).find((c) => c.itemId === itemId)!;
  return { itemId, action, today };
}

const auto = async (userId: string) => (await listReminders(userId)).filter((r) => r.preset.startsWith("auto_"));
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("automatic reminders (1 week, 3 days, day of)", () => {
  beforeEach(resetDb);

  it("schedules three reminders for every new deadline, at the user's delivery hour", async () => {
    const u = await createUser();
    const { action } = await purchase(u.id, 0);
    const due = action.dueOn!;
    const rs = await auto(u.id);
    expect(rs.map((r) => [r.preset, r.status])).toEqual([
      ["auto_7d", "scheduled"],
      ["auto_3d", "scheduled"],
      ["auto_0d", "scheduled"],
    ]);
    expect(rs.map((r) => day(r.remindAt))).toEqual([addDays(due, -7), addDays(due, -3), due]);
    // 9am New York = 13:00 or 14:00 UTC
    expect([13, 14]).toContain(rs[2]!.remindAt.getUTCHours());
  });

  it("skips reminder dates that have already passed", async () => {
    const u = await createUser();
    await purchase(u.id, 85); // due in 5 days
    expect((await auto(u.id)).map((r) => r.preset)).toEqual(["auto_3d", "auto_0d"]);
  });

  it("respects preferences, and never recreates a reminder the user cancelled", async () => {
    const u = await createUser();
    await purchase(u.id, 0);
    const threeDay = (await auto(u.id)).find((r) => r.preset === "auto_3d")!;
    await cancelReminder(u.id, threeDay.id);

    await updatePreferences(u.id, { autoOffsets: [7, 0] });
    expect((await auto(u.id)).filter((r) => r.status === "scheduled").map((r) => r.preset)).toEqual(["auto_7d", "auto_0d"]);
    await updatePreferences(u.id, { autoOffsets: [7, 3, 0] });
    expect((await auto(u.id)).find((r) => r.preset === "auto_3d")!.status).toBe("cancelled"); // stays cancelled

    await updatePreferences(u.id, { autoReminders: false });
    expect((await auto(u.id)).filter((r) => r.status === "scheduled")).toHaveLength(0);
    await updatePreferences(u.id, { autoReminders: true });
    expect((await auto(u.id)).filter((r) => r.status === "scheduled")).toHaveLength(2);

    await expect(updatePreferences(u.id, { autoOffsets: [5] })).rejects.toThrow();
  });

  it("delivers with a clear 'In 1 week' / 'Today' title, and stops once the task is done", async () => {
    const u = await createUser();
    const { action } = await purchase(u.id, 0);
    const week = (await auto(u.id)).find((r) => r.preset === "auto_7d")!;
    await adminPool().query(`update reminders set remind_at = now() - interval '1 minute' where id = $1`, [week.id]);
    await adminPool().query(`update actions set due_on = (now() at time zone 'America/New_York')::date + 7 where id = $1`, [action.actionId]);
    expect((await dispatchDueReminders()).sent).toBe(1);
    const [note] = await listNotifications(u.id);
    expect(note!.title).toMatch(/^In 1 week: Return window/);

    await setActionStatus(u.id, action.actionId, "done");
    const rest = (await auto(u.id)).filter((r) => r.status === "scheduled");
    await adminPool().query(`update reminders set remind_at = now() - interval '1 minute' where id = any($1)`, [rest.map((r) => r.id)]);
    await dispatchDueReminders();
    expect(await listNotifications(u.id)).toHaveLength(1); // nothing more after "done"
  });

  it("doesn't double-notify when a manual and an automatic reminder land together", async () => {
    const u = await createUser();
    await purchase(u.id, 0);
    const [a, b] = (await auto(u.id)).slice(0, 2);
    await adminPool().query(`update reminders set remind_at = now() - interval '1 minute' where id = any($1)`, [[a!.id, b!.id]]);
    await dispatchDueReminders();
    expect(await listNotifications(u.id)).toHaveLength(1);
  });
});
