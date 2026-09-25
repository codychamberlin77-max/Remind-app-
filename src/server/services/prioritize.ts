import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { reprioritizeUser } from "./items";

/** Daily: urgency changes with time, so scores and expiries are refreshed. */
export async function reprioritizeAll() {
  const users = await db().execute<{ user_id: string }>(sql`select user_id from app_users_with_open_actions()`);
  for (const u of users.rows) {
    await reprioritizeUser(u.user_id).catch((e) => console.error("[reprioritize]", (e as Error).message));
  }
  return users.rows.length;
}
