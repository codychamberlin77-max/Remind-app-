import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { handle } from "@/server/http/handle";
import { getForwardingStatus } from "@/server/services/inbound";

export const runtime = "nodejs";

/** Forwarding address, Gmail verification code and recent activity (polled by /email). */
export async function GET() {
  return handle(async () => {
    const user = await requireApiUser();
    return NextResponse.json(await getForwardingStatus(user.id), { headers: { "Cache-Control": "no-store" } });
  });
}
