import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { handle, isUuid } from "@/server/http/handle";
import { getDiscoveries } from "@/server/services/items";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(isUuid).slice(0, 20);
    return NextResponse.json(await getDiscoveries(user.id, ids), { headers: { "Cache-Control": "no-store" } });
  });
}
