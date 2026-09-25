import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/session";
import { todayIn } from "@/server/extraction/dates";
import { handle } from "@/server/http/handle";
import { ingest } from "@/server/ingestion/ingest";
import { buildSample } from "@/server/samples";

export const runtime = "nodejs";

const body = z.object({ id: z.enum(["receipt", "trial", "credit"]) });

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Unknown sample." }, { status: 400 });
    const s = await buildSample(parsed.data.id, todayIn(user.timezone));
    const r = await ingest({ userId: user.id, plan: user.plan, source: "sample", bytes: s.bytes, filename: s.filename });
    return NextResponse.json({ result: { filename: s.filename, ...r } });
  });
}
