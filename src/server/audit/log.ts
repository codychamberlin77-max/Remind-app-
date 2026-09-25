import { schema, type Tx } from "@/server/db/client";

type Meta = Record<string, string | number | boolean | null>;

/**
 * Audit events record THAT something happened, never WHAT a document said.
 * Metadata is restricted to primitives and must not include extracted content.
 */
export async function audit(
  tx: Tx,
  e: {
    userId: string;
    actor?: "user" | "system" | "worker";
    event: string;
    entityType?: string;
    entityId?: string;
    metadata?: Meta;
    ipHash?: string | null;
  },
) {
  await tx.insert(schema.auditEvents).values({
    userId: e.userId,
    actor: e.actor ?? "user",
    event: e.event,
    entityType: e.entityType,
    entityId: e.entityId,
    metadata: e.metadata ?? {},
    ipHash: e.ipHash ?? null,
  });
}
