import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { db, schema } from "@/server/db/client";

let admin: pg.Pool | undefined;

/** Superuser connection — ONLY for test setup/inspection, never used by app code. */
export function adminPool() {
  admin ??= new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  return admin;
}
export async function closeAdmin() {
  await admin?.end();
  admin = undefined;
}

export async function resetDb() {
  const { rows } = await adminPool().query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'categories'`,
  );
  await adminPool().query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
}

export async function createUser(overrides: Partial<{ name: string; email: string; timezone: string }> = {}) {
  const id = uuidv7();
  const [u] = await db()
    .insert(schema.users)
    .values({
      id,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${id}@example.com`,
      timezone: overrides.timezone ?? "America/New_York",
    })
    .returning();
  return u!;
}
