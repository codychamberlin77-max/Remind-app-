import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { handle, rateLimit } from "@/server/http/handle";
import { claimStuckImports, listImports, runImport, startImport } from "@/server/services/emailImport";

export const runtime = "nodejs";
export const maxDuration = 900;

/**
 * Upload a Google Takeout mailbox (.mbox or .zip). The request body is the raw
 * file, streamed straight to storage — never buffered in memory.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    if (!rateLimit(`import:${user.id}`, 3, 1)) return NextResponse.json({ error: "Please wait a minute before trying again." }, { status: 429 });
    if (!req.body) return NextResponse.json({ error: "No file received." }, { status: 400 });
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? new URL(req.url).searchParams.get("filename") ?? "");
    const declared = req.headers.get("content-length");
    const row = await startImport(user.id, { filename, body: req.body, declaredBytes: declared ? Number(declared) : null });
    return NextResponse.json({ id: row.id });
  });
}

/** Import progress (polled). Also the no-worker safety net, like document status. */
export async function GET() {
  return handle(async () => {
    const user = await requireApiUser();
    for (const id of await claimStuckImports(user.id)) {
      console.warn(`[imports] import ${id} waited with no worker; scanning in web process`);
      void runImport(user.id, id, { claimed: true }).catch((e) => console.error("[imports] fallback failed", (e as Error).message));
    }
    return NextResponse.json({ imports: await listImports(user.id) }, { headers: { "Cache-Control": "no-store" } });
  });
}
