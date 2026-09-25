/**
 * Background worker (separate Railway service, same codebase):
 *   - processes uploaded documents
 *   - delivers due reminders (every minute)
 *   - refreshes priorities / expiries (daily)
 *   - purges deleted users' objects
 */
import { PgBoss } from "pg-boss";
import { closeDb } from "@/server/db/client";
import { env } from "@/server/env";
import { handlers } from "./handlers";
import { QUEUES } from "./queues";

async function main() {
  const e = env();
  const boss = new PgBoss({ connectionString: e.DATABASE_URL, schema: "pgboss", migrate: false, supervise: true, schedule: true });
  boss.on("error", (err) => console.error("[worker] pg-boss", err.message));
  await boss.start();

  await boss.work(QUEUES.processDocument, { batchSize: 2, pollingIntervalSeconds: 0.5 }, async (jobs) => {
    for (const j of jobs) await handlers[QUEUES.processDocument](j.data as never);
  });
  await boss.work(QUEUES.dispatchReminders, async () => handlers[QUEUES.dispatchReminders]());
  await boss.work(QUEUES.reprioritize, async () => handlers[QUEUES.reprioritize]());
  await boss.work(QUEUES.purgeUserObjects, async (jobs) => {
    for (const j of jobs) await handlers[QUEUES.purgeUserObjects](j.data as never);
  });
  await boss.work(QUEUES.deleteObject, async (jobs) => {
    for (const j of jobs) await handlers[QUEUES.deleteObject](j.data as never);
  });

  await boss.schedule(QUEUES.dispatchReminders, "* * * * *");
  await boss.schedule(QUEUES.reprioritize, "15 * * * *"); // hourly: users' "today" rolls over at different times

  console.log(`[worker] started (ai=${e.AI_PROVIDER}, storage=${e.STORAGE_DRIVER})`);

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await boss.stop({ graceful: true, timeout: 20_000 });
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
