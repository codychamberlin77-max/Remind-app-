import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { clientIp, handle, rateLimit } from "@/server/http/handle";
import { ingest } from "@/server/ingestion/ingest";
import { hashIp } from "@/server/privacy/crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 10;

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser();
    const max = env().MAX_UPLOAD_BYTES;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > max * MAX_FILES + 64 * 1024) return NextResponse.json({ error: "Upload is too large." }, { status: 413 });

    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "No files received." }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Upload up to ${MAX_FILES} files at a time.` }, { status: 400 });

    const ipHash = hashIp(clientIp(req));
    const results = [];
    for (const file of files) {
      if (!rateLimit(`upload:${user.id}`, 40, 20)) {
        results.push({ filename: file.name, status: "rejected", code: "rate_limited", message: "You're uploading quickly — try again in a minute." });
        continue;
      }
      if (file.size > max) {
        results.push({ filename: file.name, status: "rejected", code: "too_large", message: `That file is larger than ${Math.round(max / 1024 / 1024)} MB.` });
        continue;
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const r = await ingest({ userId: user.id, plan: user.plan, source: "upload", bytes, filename: file.name, ipHash });
      results.push({ filename: file.name, ...r });
    }
    return NextResponse.json({ results });
  });
}
