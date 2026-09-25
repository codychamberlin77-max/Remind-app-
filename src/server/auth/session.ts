import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export type SessionUser = { id: string; email: string; name: string; timezone: string; plan: string };

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { timezone?: string; plan?: string };
  return { id: u.id, email: u.email, name: u.name, timezone: u.timezone ?? "America/New_York", plan: u.plan ?? "free" };
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
