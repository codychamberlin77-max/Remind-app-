import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { now as clockNow } from "@/server/clock";
import { db, schema, withUser, type Tx } from "@/server/db/client";
import type { ReminderChannel, ReminderPreset } from "@/server/domain/types";
import { addDays, daysBetween, formatDate, isValidIso, todayIn } from "@/server/extraction/dates";
import { priorityReason } from "@/server/derivation/priority";
import { getChannel } from "./notify";
import { NotFoundError } from "./documents";

export class ReminderInputError extends Error {
  status = 400;
}

/** Wall-clock instant for `hour:00` on `dateIso` in `timezone`. */
export function zonedInstant(dateIso: string, hour: number, timezone: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  // Start from the UTC guess, then correct by the zone's offset at that moment.
  const guess = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

/**
 * Presets resolve to a calendar date in the user's timezone, delivered at
 * their preferred hour. Presets that would land in the past fall back to the
 * soonest sensible time rather than silently never firing.
 */
export function resolveRemindDate(preset: ReminderPreset, today: string, dueOn: string | null, customDate?: string | null): string {
  switch (preset) {
    case "today":
      return today;
    case "tomorrow":
      return addDays(today, 1);
    case "3_days_before":
    case "1_week_before": {
      if (!dueOn) throw new ReminderInputError("This item has no date to count back from.");
      const d = addDays(dueOn, preset === "3_days_before" ? -3 : -7);
      return daysBetween(today, d) < 0 ? today : d;
    }
    case "custom": {
      if (!customDate || !isValidIso(customDate)) throw new ReminderInputError("Choose a valid date.");
      if (daysBetween(today, customDate) < 0) throw new ReminderInputError("Choose a date in the future.");
      if (daysBetween(today, customDate) > 3650) throw new ReminderInputError("Choose a date within 10 years.");
      return customDate;
    }
  }
}

async function prefsFor(tx: Tx, userId: string) {
  const [p] = await tx.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
  return p ?? { emailEnabled: true, inAppEnabled: true, deliveryHour: 9, defaultPreset: "3_days_before" as ReminderPreset };
}

async function userTimezone(userId: string) {
  const [u] = await db().select({ timezone: schema.users.timezone }).from(schema.users).where(eq(schema.users.id, userId));
  return u?.timezone ?? "America/New_York";
}

function channelsFrom(p: { emailEnabled: boolean; inAppEnabled: boolean }): ReminderChannel[] {
  const c: ReminderChannel[] = [];
  if (p.inAppEnabled) c.push("in_app");
  if (p.emailEnabled) c.push("email");
  return c.length ? c : ["in_app"];
}

export async function createReminder(
  userId: string,
  input: { actionId: string; preset: ReminderPreset; customDate?: string | null },
  opts: { now?: Date } = {},
) {
  const tz = await userTimezone(userId);
  const now = opts.now ?? clockNow();
  const today = todayIn(tz, now);
  return withUser(userId, async (tx) => {
    const [action] = await tx
      .select({ id: schema.actions.id, dueOn: schema.actions.dueOn, status: schema.actions.status })
      .from(schema.actions)
      .where(and(eq(schema.actions.userId, userId), eq(schema.actions.id, input.actionId)));
    if (!action) throw new NotFoundError();
    const prefs = await prefsFor(tx, userId);
    const date = resolveRemindDate(input.preset, today, action.dueOn, input.customDate);
    let remindAt = zonedInstant(date, prefs.deliveryHour, tz);
    // "Today" after the delivery hour means "shortly".
    if (remindAt.getTime() < now.getTime()) remindAt = new Date(now.getTime() + 5 * 60_000);

    // One pending reminder per action: replace instead of stacking duplicates.
    await tx
      .update(schema.reminders)
      .set({ status: "cancelled" })
      .where(and(eq(schema.reminders.userId, userId), eq(schema.reminders.actionId, action.id), eq(schema.reminders.status, "scheduled")));
    const [r] = await tx
      .insert(schema.reminders)
      .values({ userId, actionId: action.id, remindAt, preset: input.preset, channels: channelsFrom(prefs) })
      .returning();
    await audit(tx, { userId, event: "reminder.created", entityType: "reminder", entityId: r!.id, metadata: { preset: input.preset } });
    return r!;
  });
}

export async function cancelReminder(userId: string, reminderId: string) {
  return withUser(userId, async (tx) => {
    const res = await tx
      .update(schema.reminders)
      .set({ status: "cancelled" })
      .where(and(eq(schema.reminders.userId, userId), eq(schema.reminders.id, reminderId), eq(schema.reminders.status, "scheduled")))
      .returning({ id: schema.reminders.id });
    if (!res.length) throw new NotFoundError();
  });
}

export async function listReminders(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: schema.reminders.id,
        remindAt: schema.reminders.remindAt,
        preset: schema.reminders.preset,
        status: schema.reminders.status,
        channels: schema.reminders.channels,
        sentAt: schema.reminders.sentAt,
        actionId: schema.actions.id,
        actionTitle: schema.actions.title,
        itemId: schema.actions.itemId,
        dueOn: schema.actions.dueOn,
      })
      .from(schema.reminders)
      .innerJoin(schema.actions, eq(schema.actions.id, schema.reminders.actionId))
      .where(eq(schema.reminders.userId, userId))
      .orderBy(asc(schema.reminders.remindAt)),
  );
}

/** Keeps relative presets aligned when a due date changes (e.g. after an edit). */
export async function rescheduleForAction(tx: Tx, userId: string, actionId: string, dueOn: string | null, tz: string) {
  const pending = await tx
    .select()
    .from(schema.reminders)
    .where(and(eq(schema.reminders.userId, userId), eq(schema.reminders.actionId, actionId), eq(schema.reminders.status, "scheduled")));
  const prefs = await prefsFor(tx, userId);
  const today = todayIn(tz);
  for (const r of pending) {
    if (r.preset !== "3_days_before" && r.preset !== "1_week_before") continue;
    if (!dueOn) {
      await tx.update(schema.reminders).set({ status: "cancelled" }).where(eq(schema.reminders.id, r.id));
      continue;
    }
    const date = resolveRemindDate(r.preset, today, dueOn);
    await tx.update(schema.reminders).set({ remindAt: zonedInstant(date, prefs.deliveryHour, tz) }).where(eq(schema.reminders.id, r.id));
  }
}

/**
 * Worker: deliver due reminders. The cross-user scan goes through a SECURITY
 * DEFINER function that returns ids only; each reminder is then handled inside
 * its owner's RLS context.
 */
export async function dispatchDueReminders(limit = 100): Promise<{ sent: number; failed: number }> {
  const due = await db().execute<{ id: string; user_id: string }>(sql`select id, user_id from app_due_reminders(${limit})`);
  let sent = 0;
  let failed = 0;
  for (const row of due.rows) {
    const ok = await deliverOne(row.user_id, row.id).catch((e) => {
      console.error("[reminders] delivery error", (e as Error).message);
      return false;
    });
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

async function deliverOne(userId: string, reminderId: string): Promise<boolean> {
  const tz = await userTimezone(userId);
  const today = todayIn(tz);
  const [user] = await db().select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  return withUser(userId, async (tx) => {
    const [r] = await tx
      .select({ reminder: schema.reminders, action: schema.actions, itemTitle: schema.items.title })
      .from(schema.reminders)
      .innerJoin(schema.actions, eq(schema.actions.id, schema.reminders.actionId))
      .innerJoin(schema.items, eq(schema.items.id, schema.actions.itemId))
      .where(and(eq(schema.reminders.userId, userId), eq(schema.reminders.id, reminderId)))
      .for("update", { skipLocked: true });
    if (!r || r.reminder.status !== "scheduled") return false;

    // Nothing to nag about if the user already handled it.
    if (r.action.status === "done" || r.action.status === "dismissed") {
      await tx.update(schema.reminders).set({ status: "cancelled" }).where(eq(schema.reminders.id, reminderId));
      return true;
    }

    const title = r.action.title;
    const body = [
      priorityReason(r.action, today),
      r.action.dueCertainty === "estimated" && r.action.description ? r.action.description : null,
      r.action.dueOn ? `Due ${formatDate(r.action.dueOn)}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const errors: string[] = [];
    for (const ch of r.reminder.channels) {
      try {
        await getChannel(ch).send(tx, { userId, email: user?.email ?? null, name: user?.name ?? null, reminderId, actionId: r.action.id, itemId: r.action.itemId, title, body });
      } catch (e) {
        errors.push(`${ch}: ${(e as Error).message}`);
      }
    }
    const allFailed = errors.length === r.reminder.channels.length;
    const attempts = r.reminder.attempts + 1;
    await tx
      .update(schema.reminders)
      .set(
        allFailed
          ? { attempts, lastError: errors.join("; ").slice(0, 500), status: attempts >= 5 ? "failed" : "scheduled", remindAt: new Date(Date.now() + attempts * 10 * 60_000) }
          : { attempts, status: "sent", sentAt: new Date(), lastError: errors.length ? errors.join("; ").slice(0, 500) : null },
      )
      .where(eq(schema.reminders.id, reminderId));
    await audit(tx, { userId, actor: "worker", event: allFailed ? "reminder.failed" : "reminder.sent", entityType: "reminder", entityId: reminderId });
    return !allFailed;
  });
}

export async function listNotifications(userId: string, limit = 30) {
  return withUser(userId, (tx) =>
    tx
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.channel, "in_app")))
      .orderBy(sql`${schema.notifications.createdAt} desc`)
      .limit(limit),
  );
}

export async function markNotificationsRead(userId: string, ids: string[]) {
  if (!ids.length) return;
  await withUser(userId, (tx) =>
    tx
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.userId, userId), inArray(schema.notifications.id, ids))),
  );
}

export async function getPreferences(userId: string) {
  return withUser(userId, (tx) => prefsFor(tx, userId));
}

export async function updatePreferences(
  userId: string,
  p: { emailEnabled?: boolean; inAppEnabled?: boolean; deliveryHour?: number; defaultPreset?: ReminderPreset },
) {
  if (p.deliveryHour != null && (!Number.isInteger(p.deliveryHour) || p.deliveryHour < 0 || p.deliveryHour > 23)) {
    throw new ReminderInputError("Invalid hour");
  }
  return withUser(userId, async (tx) => {
    await tx
      .insert(schema.notificationPreferences)
      .values({ userId, ...p })
      .onConflictDoUpdate({ target: schema.notificationPreferences.userId, set: p });
    await audit(tx, { userId, event: "preferences.updated" });
  });
}
