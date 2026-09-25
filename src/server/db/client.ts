import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "@/server/env";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __lifeosPool?: pg.Pool; __lifeosDb?: DB };

export function pool(): pg.Pool {
  if (!globalForDb.__lifeosPool) {
    globalForDb.__lifeosPool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 10 });
  }
  return globalForDb.__lifeosPool;
}

/**
 * Raw database handle. Only auth code and the RLS-exempt worker scans should use
 * this directly; everything touching user data goes through `withUser`.
 */
export function db(): DB {
  if (!globalForDb.__lifeosDb) globalForDb.__lifeosDb = drizzle(pool(), { schema });
  return globalForDb.__lifeosDb;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction whose RLS context is `userId`. Every user-data query
 * in the app goes through here: repositories also filter by user_id explicitly,
 * and Postgres enforces the same boundary underneath.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("withUser: invalid user id");
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  await globalForDb.__lifeosPool?.end();
  globalForDb.__lifeosPool = undefined;
  globalForDb.__lifeosDb = undefined;
}

export { schema };
