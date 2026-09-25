/**
 * Applies migrations as the owner role, then (idempotently):
 *  - enables LOGIN on `lifeos_app` with APP_DB_PASSWORD if provided
 *  - installs the pg-boss schema and queues, and grants the app role access
 *
 * Usage: DATABASE_ADMIN_URL=… [APP_DB_PASSWORD=…] npm run db:migrate
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { QUEUES } from "../src/server/jobs/queues";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is required");
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  await migrate(drizzle(pool), { migrationsFolder: "src/server/db/migrations" });

  const q = (s: string) => pool.query(s);
  if (process.env.APP_DB_PASSWORD) {
    const pw = process.env.APP_DB_PASSWORD.replaceAll("'", "''");
    await q(`ALTER ROLE lifeos_app LOGIN PASSWORD '${pw}'`);
  }
  // New tables must be reachable (and covered by RLS; a test enforces that).
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lifeos_app`);
  await q(`REVOKE INSERT, UPDATE, DELETE ON categories FROM lifeos_app`);

  const boss = new PgBoss({ connectionString: url, schema: "pgboss", supervise: false, schedule: false });
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name).catch(() => undefined);
  }
  await boss.stop({ graceful: false });
  await q(`GRANT USAGE ON SCHEMA pgboss TO lifeos_app`);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO lifeos_app`);
  await q(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pgboss TO lifeos_app`);
  await q(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO lifeos_app`);

  await pool.end();
  console.log("migrations applied");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
