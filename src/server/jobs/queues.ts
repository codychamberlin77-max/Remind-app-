/** Queue names. Payloads carry ids only — never document content. */
export const QUEUES = {
  processDocument: "process-document",
  dispatchReminders: "dispatch-reminders",
  reprioritize: "reprioritize",
  purgeUserObjects: "purge-user-objects",
  deleteObject: "delete-object",
  importMailbox: "import-mailbox",
} as const;

export type ProcessDocumentJob = { userId: string; documentId: string };
export type PurgeUserObjectsJob = { userId: string };
export type DeleteObjectJob = { userId: string; storageKey: string };
export type ImportMailboxJob = { userId: string; importId: string };
