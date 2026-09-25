import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";

function build() {
  const e = env();
  const google =
    e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return betterAuth({
    appName: "LIFEOS",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "lifeos",
      useSecureCookies: e.NODE_ENV === "production",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders: google,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        timezone: { type: "string", required: false, defaultValue: "America/New_York", input: true },
        plan: { type: "string", required: false, defaultValue: "free", input: false },
      },
      deleteUser: { enabled: false }, // account deletion goes through our deletion service
    },
    rateLimit: {
      enabled: e.NODE_ENV !== "test",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __lifeosAuth?: Auth };

export function auth(): Auth {
  if (!g.__lifeosAuth) g.__lifeosAuth = build();
  return g.__lifeosAuth;
}
