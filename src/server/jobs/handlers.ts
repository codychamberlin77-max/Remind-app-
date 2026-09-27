import { processDocument } from "@/server/extraction/pipeline";
import { objectStore, userPrefix } from "@/server/storage/objectStore";
import { dispatchDueReminders } from "@/server/services/reminders";
import { reprioritizeAll } from "@/server/services/prioritize";
import { runImport } from "@/server/services/emailImport";
import { QUEUES, type DeleteObjectJob, type ImportMailboxJob, type ProcessDocumentJob, type PurgeUserObjectsJob } from "./queues";

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
  [QUEUES.reprioritize]: async () => {
    await reprioritizeAll();
  },
} as const;
