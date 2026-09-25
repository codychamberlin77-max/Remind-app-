import { PgBoss } from "pg-boss";
import { env } from "@/server/env";
import { QUEUES, type DeleteObjectJob, type ProcessDocumentJob, type PurgeUserObjectsJob } from "./queues";

type Payloads = {
  [QUEUES.processDocument]: ProcessDocumentJob;
  [QUEUES.purgeUserObjects]: PurgeUserObjectsJob;
  [QUEUES.deleteObject]: DeleteObjectJob;
  [QUEUES.dispatchReminders]: Record<string, never>;
  [QUEUES.reprioritize]: Record<string, never>;
};
export type QueueName = keyof Payloads;

const g = globalThis as unknown as { __lifeosBoss?: Promise<PgBoss> };

export function boss(): Promise<PgBoss> {
  if (!g.__lifeosBoss) {
    const b = new PgBoss({
      connectionString: env().DATABASE_URL,
      schema: "pgboss",
      migrate: false, // schema is installed by `npm run db:migrate` as the owner role
      supervise: false,
      schedule: false,
    });
    b.on("error", (e) => console.error("[pg-boss]", e.message));
    g.__lifeosBoss = b.start();
  }
  return g.__lifeosBoss;
}

/**
 * Enqueue a job. In JOBS_MODE=inline (tests, simplest local dev) the handler runs
 * in-process and is awaited, so behavior is identical minus the queue.
 */
export async function enqueue<Q extends QueueName>(name: Q, data: Payloads[Q]): Promise<void> {
  if (env().JOBS_MODE === "inline") {
    const { handlers } = await import("./handlers");
    await handlers[name](data as never);
    return;
  }
  const b = await boss();
  await b.send(name, data, {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    ...(name === QUEUES.processDocument ? { singletonKey: (data as ProcessDocumentJob).documentId } : {}),
  });
}
