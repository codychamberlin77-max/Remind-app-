import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Deliveries from the mail relay are signed:
 *   signature = hex(HMAC-SHA256(secret, `${timestamp}.${to}.` + rawMessageBytes))
 * and rejected if older than 5 minutes (replay protection).
 */
export const MAX_SKEW_SECONDS = 300;

export function signInbound(secret: string, timestamp: string, to: string, raw: Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.${to}.`).update(raw).digest("hex");
}

export function verifyInbound(
  secret: string,
  headers: { timestamp: string | null; signature: string | null; to: string | null },
  raw: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { timestamp, signature, to } = headers;
  if (!timestamp || !signature || !to || !/^\d{9,11}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(signInbound(secret, timestamp, to, raw), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
