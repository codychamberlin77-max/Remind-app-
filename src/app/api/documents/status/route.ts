import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { schema, withUser } from "@/server/db/client";
import { processDocument } from "@/server/extraction/pipeline";
import { handle, isUuid } from "@/server/http/handle";

export const runtime = "nodejs";

/** A queued document nobody has picked up within this window is processed here instead. */
const FALLBACK_AFTER_MS = 15_000;

/**
 * Pipeline progress for the upload screen (polled).
 *
 * Safety net: if the background worker is down or misconfigured, documents
 * would wait forever. After FALLBACK_AFTER_MS we atomically claim the document
 * (queued → processing) and run the pipeline in this process. Processing is
 * idempotent, so a late worker pickup can't corrupt anything.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(isUuid).slice(0, 20);
    if (!ids.length) return NextResponse.json({ documents: [] });

    const claimed = await withUser(user.id, (tx) =>
      tx
        .update(schema.documents)
        .set({ status: "processing", stage: "reading" })
        .where(
          and(
            eq(schema.documents.userId, user.id),
            inArray(schema.documents.id, ids),
            eq(schema.documents.status, "queued"),
            lt(schema.documents.createdAt, sql`now() - make_interval(secs => ${FALLBACK_AFTER_MS / 1000})`),
          ),
        )
        .returning({ id: schema.documents.id }),
    );
    for (const c of claimed) {
      console.warn(`[status] document ${c.id} waited ${FALLBACK_AFTER_MS / 1000}s with no worker; processing in web process`);
      void processDocument(user.id, c.id).catch((e) => console.error("[status] fallback processing failed", (e as Error).message));
    }

    const documents = await withUser(user.id, (tx) =>
      tx
        .select({ id: schema.documents.id, status: schema.documents.status, stage: schema.documents.stage, failureReason: schema.documents.failureReason })
        .from(schema.documents)
        .where(and(eq(schema.documents.userId, user.id), inArray(schema.documents.id, ids))),
    );
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  });
}
