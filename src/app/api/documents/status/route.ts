import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { schema, withUser } from "@/server/db/client";
import { handle, isUuid } from "@/server/http/handle";

export const runtime = "nodejs";

/** Pipeline progress for the upload screen (polled). */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(isUuid).slice(0, 20);
    if (!ids.length) return NextResponse.json({ documents: [] });
    const documents = await withUser(user.id, (tx) =>
      tx
        .select({ id: schema.documents.id, status: schema.documents.status, stage: schema.documents.stage, failureReason: schema.documents.failureReason })
        .from(schema.documents)
        .where(and(eq(schema.documents.userId, user.id), inArray(schema.documents.id, ids))),
    );
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  });
}
