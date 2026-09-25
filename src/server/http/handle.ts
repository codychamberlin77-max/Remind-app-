import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/documents";
import { InputError } from "@/server/services/items";
import { ReminderInputError } from "@/server/services/reminders";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/** Maps domain errors to HTTP without leaking internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (e instanceof InputError || e instanceof ReminderInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api]", (e as Error).message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** Minimal per-process rate limiter (single Railway instance for MVP). */
const buckets = new Map<string, { tokens: number; at: number }>();
export function rateLimit(key: string, capacity: number, refillPerMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * refillPerMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
}
