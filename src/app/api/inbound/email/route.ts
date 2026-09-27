import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { verifyInbound } from "@/server/http/inboundSignature";
import { inboundDomain, receiveInboundEmail } from "@/server/services/inbound";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;

/**
 * Receives raw email (message/rfc822) from the mail relay — see
 * deploy/cloudflare-email-worker. No session: authenticity comes from the HMAC
 * signature, and the recipient token decides which user it belongs to.
 */
export async function POST(req: Request) {
  const secret = env().INBOUND_EMAIL_SECRET;
  if (!inboundDomain() || !secret) return NextResponse.json({ error: "not_configured" }, { status: 404 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_MESSAGE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length === 0 || raw.length > MAX_MESSAGE_BYTES) return NextResponse.json({ error: "bad_size" }, { status: 413 });

  const to = req.headers.get("x-lifeos-to");
  const ok = verifyInbound(secret, { timestamp: req.headers.get("x-lifeos-timestamp"), signature: req.headers.get("x-lifeos-signature"), to }, raw);
  if (!ok) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  try {
    const result = await receiveInboundEmail({ to: to!, raw });
    if (result.status === "unknown_recipient") return NextResponse.json(result, { status: 404 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[inbound] failed", (e as Error).message);
    // 5xx → the relay reports a temporary failure and the sender's server retries.
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
