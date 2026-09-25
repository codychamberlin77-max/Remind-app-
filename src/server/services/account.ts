import { eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { db, schema, withUser } from "@/server/db/client";
import { enqueue } from "@/server/jobs/queue";
import { QUEUES } from "@/server/jobs/queues";
import { objectStore, userPrefix } from "@/server/storage/objectStore";
import { InputError } from "./items";

export async function updateProfile(userId: string, p: { name?: string; timezone?: string }) {
  if (p.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: p.timezone });
    } catch {
      throw new InputError("Unknown timezone.");
    }
  }
  await db().update(schema.users).set(p).where(eq(schema.users.id, userId));
  await withUser(userId, (tx) => audit(tx, { userId, event: "profile.updated" }));
}

async function purgeObjects(userId: string) {
  try {
    await objectStore().deletePrefix(userPrefix(userId));
  } catch {
    await enqueue(QUEUES.purgeUserObjects, { userId });
  }
}

/**
 * Deletes every document, file and extracted record but keeps the account.
 */
export async function deleteAllData(userId: string) {
  await withUser(userId, async (tx) => {
    await tx.delete(schema.documents).where(eq(schema.documents.userId, userId)); // cascades to items → facts/actions/reminders/protections
    await tx.delete(schema.items).where(eq(schema.items.userId, userId)); // any item not tied to a document
    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
    await tx.delete(schema.financialOutcomes).where(eq(schema.financialOutcomes.userId, userId));
    await audit(tx, { userId, event: "data.deleted_all" });
  });
  await purgeObjects(userId);
}

/**
 * Hard-deletes the account. Every user-owned row cascades from `users`; audit
 * events keep only the fact that a deletion happened (user_id → NULL).
 */
export async function deleteAccount(userId: string) {
  await withUser(userId, (tx) => audit(tx, { userId, event: "account.deleted" }));
  await db().transaction(async (tx) => {
    // Session/auth rows are not under RLS; the users row cascade removes them too.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
  await purgeObjects(userId);
}
