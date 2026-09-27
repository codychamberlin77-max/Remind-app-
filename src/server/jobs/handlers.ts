import { processDocument } from "@/server/extraction/pipeline";
import { objectStore, userPrefix } from "@/server/storage/objectStore";
import { dispatchDueReminders } from "@/server/services/reminders";
import { reprioritizeAll } from "@/server/services/prioritize";
import { runImport } from "@/server/services/emailImport";
import { applyPolicyLookups } from "@/server/policies/apply";
import { activeConnections, syncConnection } from "@/server/services/connections";
import { env } from "@/server/env";
import { enqueue } from "./queue";
import { QUEUES, type DeleteObjectJob, type ImportMailboxJob, type LookupPolicyJob, type ProcessDocumentJob, type SyncMailboxJob, type PurgeUserObjectsJob } from "./queues";

export const handlers = {
  [QUEUES.processDocument]: (job: ProcessDocumentJob) => processDocument(job.userId, job.documentId),
  [QUEUES.purgeUserObjects]: async (job: PurgeUserObjectsJob) => {
    await objectStore().deletePrefix(userPrefix(job.userId));
  },
  [QUEUES.deleteObject]: async (job: DeleteObjectJob) => {
    if (!job.storageKey.startsWith(userPrefix(job.userId))) throw new Error("key/user mismatch");
    await objectStore().delete(job.storageKey);
  },
  [QUEUES.dispatchReminders]: async () => {
    await dispatchDueReminders();
  },
  [QUEUES.importMailbox]: async (job: ImportMailboxJob) => {
    await runImport(job.userId, job.importId);
  },
  [QUEUES.lookupPolicy]: async (job: LookupPolicyJob) => {
    await applyPolicyLookups(job.userId, job.itemId);
  },
  [QUEUES.syncMailbox]: async (job: SyncMailboxJob) => {
    const r = await syncConnection(job.userId, job.connectionId);
    // First sync of a big inbox runs in slices; keep going until caught up.
    if (r?.more && env().JOBS_MODE !== "inline") await enqueue(QUEUES.syncMailbox, job);
  },
  [QUEUES.syncMailboxes]: async () => {
    for (const c of await activeConnections()) await enqueue(QUEUES.syncMailbox, { userId: c.user_id, connectionId: c.id });
  },
  [QUEUES.reprioritize]: async () => {
    await reprioritizeAll();
  },
} as const;
