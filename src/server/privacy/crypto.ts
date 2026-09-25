import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/server/env";

/**
 * App-level AES-256-GCM for the highest-risk fields (OAuth refresh tokens,
 * confirmation / credit codes). Format: [1-byte version][12-byte IV][16-byte tag][ciphertext].
 * The key comes from env today; the version byte leaves room for KMS key rotation.
 */
const VERSION = 1;

function key(): Buffer {
  const k = Buffer.from(env().FIELD_ENCRYPTION_KEY, "base64");
  if (k.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptField(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decryptField(blob: Buffer): string {
  if (blob[0] !== VERSION) throw new Error("unsupported ciphertext version");
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString("utf8");
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** One-way hash for audit IPs (salted with the auth secret so it can't be rainbow-tabled). */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env().BETTER_AUTH_SECRET}:${ip}`).digest("hex").slice(0, 32);
}
