import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema, withUser } from "@/server/db/client";
import { RLS_TABLES } from "@/server/db/schema";
import { adminPool, createUser, resetDb } from "../helpers/db";

const AUTH_TABLES = new Set(["users", "sessions", "accounts", "verifications"]);

async function insertDoc(userId: string) {
  return withUser(userId, async (tx) => {
    const [d] = await tx
      .insert(schema.documents)
      .values({
        userId,
        source: "upload",
        storageKey: `u/${userId}/x`,
        originalFilename: "r.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
      })
      .returning();
    return d!;
  });
}

describe("row-level security", () => {
  beforeEach(resetDb);

  it("covers every table that has a user_id column (except auth tables)", async () => {
    const { rows } = await adminPool().query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'user_id'`,
    );
    const userTables = rows.map((r) => r.table_name).filter((t) => !AUTH_TABLES.has(t));
    expect(new Set(userTables)).toEqual(new Set(RLS_TABLES));

    const { rows: flags } = await adminPool().query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1)`,
      [userTables],
    );
    for (const f of flags) {
      expect(f.relrowsecurity, `${f.relname} RLS enabled`).toBe(true);
      expect(f.relforcerowsecurity, `${f.relname} RLS forced`).toBe(true);
    }
  });

  it("runtime role is not a superuser, cannot bypass RLS, and owns no tables", async () => {
    const r = await db().execute<{ rolsuper: boolean; rolbypassrls: boolean; owned: number }>(sql`
      select rolsuper, rolbypassrls,
        (select count(*)::int from pg_tables where tableowner = current_user) as owned
      from pg_roles where rolname = current_user`);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
  });

  it("user B cannot read, update, or delete user A's rows", async () => {
    const a = await createUser();
    const b = await createUser();
    const doc = await insertDoc(a.id);

    const seenByB = await withUser(b.id, (tx) => tx.select().from(schema.documents));
    expect(seenByB).toHaveLength(0);

    const byIdAsB = await withUser(b.id, (tx) =>
      tx.select().from(schema.documents).where(eq(schema.documents.id, doc.id)),
    );
    expect(byIdAsB).toHaveLength(0);

    const updated = await withUser(b.id, (tx) =>
      tx.update(schema.documents).set({ originalFilename: "pwned" }).where(eq(schema.documents.id, doc.id)).returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withUser(b.id, (tx) =>
      tx.delete(schema.documents).where(eq(schema.documents.id, doc.id)).returning(),
    );
    expect(deleted).toHaveLength(0);

    const stillThere = await withUser(a.id, (tx) => tx.select().from(schema.documents));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]!.originalFilename).toBe("r.pdf");
  });

  it("user B cannot write rows owned by user A", async () => {
    const a = await createUser();
    const b = await createUser();
    await expect(
      withUser(b.id, (tx) =>
        tx.insert(schema.documents).values({
          userId: a.id,
          source: "upload",
          storageKey: "k",
          originalFilename: "x",
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: "b".repeat(64),
        }),
      ),
    ).rejects.toThrow();
  });

  it("queries without a user context see nothing (a forgotten filter can't leak)", async () => {
    const a = await createUser();
    await insertDoc(a.id);
    const rows = await db().select().from(schema.documents);
    expect(rows).toHaveLength(0);
  });

  it("rejects a malformed user id before touching the database", async () => {
    await expect(withUser("1 or 1=1", async () => 1)).rejects.toThrow(/invalid user id/);
  });
});
