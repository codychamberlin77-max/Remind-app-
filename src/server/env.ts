import { z } from "zod";

/**
 * Server environment. Parsed lazily so `next build` and unit tests that never
 * touch a given subsystem don't need every variable set.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

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
