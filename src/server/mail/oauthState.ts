import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * OAuth `state`: a signed, short-lived token binding the redirect to the
 * signed-in user who started it (CSRF + account-mixup protection). The PKCE
 * verifier travels in an httpOnly cookie and must match the state's hash.
 */

const TTL_MS = 10 * 60_000;

function key() {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update("lifeos-mail-oauth").digest();
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function signState(p: { userId: string; provider: string; verifier: string }, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: p.userId, p: p.provider, v: createHash("sha256").update(p.verifier).digest("base64url").slice(0, 22), t: now, n: randomBytes(8).toString("base64url") }),
  ).toString("base64url");
  const sig = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string, expect: { userId: string; provider: string; verifier: string | undefined }, now = Date.now()): boolean {
  const [payload, sig] = state.split(".");
  if (!payload || !sig || !expect.verifier) return false;
  const want = createHmac("sha256", key()).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; p: string; v: string; t: number };
    return (
      j.u === expect.userId &&
      j.p === expect.provider &&
      j.v === createHash("sha256").update(expect.verifier).digest("base64url").slice(0, 22) &&
      now - j.t >= 0 &&
      now - j.t < TTL_MS
    );
  } catch {
    return false;
  }
}
