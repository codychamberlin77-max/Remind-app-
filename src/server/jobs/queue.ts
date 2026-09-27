import { PgBoss } from "pg-boss";
import { env } from "@/server/env";
import { QUEUES, type DeleteObjectJob, type ImportMailboxJob, type LookupPolicyJob, type ProcessDocumentJob, type SyncMailboxJob, type PurgeUserObjectsJob } from "./queues";

type Payloads = {
  [QUEUES.processDocument]: ProcessDocumentJob;
  [QUEUES.purgeUserObjects]: PurgeUserObjectsJob;
  [QUEUES.deleteObject]: DeleteObjectJob;
  [QUEUES.importMailbox]: ImportMailboxJob;
  [QUEUES.lookupPolicy]: LookupPolicyJob;
  [QUEUES.syncMailbox]: SyncMailboxJob;
  [QUEUES.syncMailboxes]: Record<string, never>;
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
    ...(name === QUEUES.syncMailbox ? { singletonKey: (data as SyncMailboxJob).connectionId, retryLimit: 1 } : {}),
    ...(name === QUEUES.lookupPolicy ? { singletonKey: (data as LookupPolicyJob).itemId, retryLimit: 1 } : {}),
    ...(name === QUEUES.importMailbox ? { singletonKey: (data as ImportMailboxJob).importId, retryLimit: 1, expireInSeconds: 3 * 3600 } : {}),
  });
}
