import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { enqueue } from "@/server/jobs/queue";
import { QUEUES } from "@/server/jobs/queues";
import { verifyState } from "@/server/mail/oauthState";
import { isMailProviderId } from "@/server/mail/providers";
import { completeConnection } from "@/server/services/connections";
import { InputError } from "@/server/services/items";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Provider redirects here after consent. Verifies state + PKCE, stores encrypted tokens, starts the first sync. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const base = env().APP_URL;
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${base}/email?${q}`);
  if (!isMailProviderId(provider)) return back("connect_error=unavailable");

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${base}/sign-in`);
  const jar = await cookies();
  const verifier = jar.get(`lifeos_mail_pkce_${provider}`)?.value;
  jar.delete({ name: `lifeos_mail_pkce_${provider}`, path: "/api/connections" });

  if (url.searchParams.get("error")) return back("connect_error=denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code || !verifyState(state, { userId: user.id, provider, verifier })) return back("connect_error=expired");

  try {
    const connectionId = await completeConnection(user.id, provider, { code, codeVerifier: verifier! });
    await enqueue(QUEUES.syncMailbox, { userId: user.id, connectionId }).catch((e) => console.error("[connect] first sync not queued", (e as Error).message));
    return back(`connected=${provider}`);
  } catch (e) {
    console.error("[connect] failed", provider, (e as Error).message);
    return back(e instanceof InputError ? "connect_error=no_offline_access" : "connect_error=failed");
  }
}
