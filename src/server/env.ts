import { z } from "zod";

/**
 * Server environment. Parsed lazily so `next build` and unit tests that never
 * touch a given subsystem don't need every variable set.
 */
/**
 * Accept the common ways APP_URL gets mistyped in a hosting dashboard (quotes,
 * spaces, missing scheme, trailing slash, an unresolved template). If it still
 * isn't usable, fall back to the platform-provided public domain.
 */
function normalizeAppUrl(raw: unknown): string {
  const clean = (v: string) => {
    let u = v.trim().replace(/^['"]|['"]$/g, "").trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u;
  };
  const candidates = [
    typeof raw === "string" && !raw.includes("${{") ? clean(raw) : "",
    process.env.RAILWAY_PUBLIC_DOMAIN ? clean(process.env.RAILWAY_PUBLIC_DOMAIN) : "",
  ];
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (u.hostname && u.hostname.includes(".") || u.hostname === "localhost") return u.origin;
    } catch {
      /* try next */
    }
  }
  return typeof raw === "string" && raw ? raw : "http://localhost:3000";
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.preprocess(normalizeAppUrl, z.string().url()),

  // Runtime role: NOT a superuser, NOT the table owner, no BYPASSRLS.
  DATABASE_URL: z.string().min(1),
  // Owner role, used only by migrations / setup scripts.
  DATABASE_ADMIN_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["r2", "local"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/objects"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  AI_PROVIDER: z.enum(["mock", "anthropic", "openai"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_MODEL_STRONG: z.string().optional(),

  // 32 bytes, base64. Used for app-level envelope encryption of high-risk fields.
  FIELD_ENCRYPTION_KEY: z.string().min(40),

  EMAIL_DRIVER: z.enum(["log", "resend"]).default("log"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("LIFEOS <reminders@localhost>"),

  // Email forwarding (Phase 1.5). Addresses look like <token>@INBOUND_EMAIL_DOMAIN.
  INBOUND_EMAIL_DOMAIN: z.string().optional(),
  // Shared secret the inbound mail relay (Cloudflare Email Worker) signs each delivery with.
  INBOUND_EMAIL_SECRET: z.string().optional(),
  // Past-email import (Google Takeout .mbox / .zip).
  MAX_IMPORT_BYTES: z.coerce.number().int().positive().default(1024 * 1024 * 1024),
  // "Connect Gmail / Outlook" (read-only inbox access). Gmail falls back to the Google sign-in client.
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /** How far back the first sync of a newly connected inbox looks. */
  MAIL_SYNC_BACKFILL_DAYS: z.coerce.number().int().positive().max(730).default(90),
  // Web lookups of store return policies / manufacturer warranties (shared cache, see src/server/policies).
  POLICY_LOOKUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** New (uncached) web lookups per day across all users. Each costs a web search plus model tokens. */
  POLICY_LOOKUP_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(100),
  // Sign-ups per IP per minute (raised only for the e2e suite, which signs up many users).
  SIGNUP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  MAX_IMPORT_DOCUMENTS: z.coerce.number().int().positive().default(300),

  // "inline" runs jobs in-process (tests, simple local dev); "queue" uses pg-boss + worker.
  JOBS_MODE: z.enum(["queue", "inline"]).default("queue"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
      throw new Error(`Invalid environment configuration:\n  ${issues}`);
    }
    if (parsed.data.STORAGE_DRIVER === "r2") {
      for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const) {
        if (!parsed.data[k]) throw new Error(`STORAGE_DRIVER=r2 requires ${k}`);
      }
    }
    if (parsed.data.INBOUND_EMAIL_DOMAIN && (parsed.data.INBOUND_EMAIL_SECRET ?? "").length < 24) {
      throw new Error("INBOUND_EMAIL_DOMAIN requires INBOUND_EMAIL_SECRET (at least 24 characters)");
    }
    if (parsed.data.AI_PROVIDER === "anthropic" && !parsed.data.ANTHROPIC_API_KEY) {
      throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper: force re-read of process.env. */
export function resetEnvCache() {
  cached = undefined;
}
