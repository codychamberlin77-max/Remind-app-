import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { auth } from "./auth";

export type SessionUser = { id: string; email: string; name: string; timezone: string; plan: string };

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  // Timezone and plan come from the users table: the session copy can be stale or missing,
  // and "today" must match what the rest of the app (reminders, deadlines) uses.
  const [row] = await db()
    .select({ name: schema.users.name, timezone: schema.users.timezone, plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id));
  if (!row) return null;
  return { id: session.user.id, email: session.user.email, name: row.name, timezone: row.timezone, plan: row.plan };
}

/** For server components / actions: redirect to sign-in when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

export class UnauthorizedError extends Error {
  status = 401;
}

/** For route handlers: throw → 401. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError("unauthorized");
  return user;
}
