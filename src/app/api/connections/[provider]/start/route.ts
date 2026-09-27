import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { newPkce, signState } from "@/server/mail/oauthState";
import { isMailProviderId, mailProvider } from "@/server/mail/providers";
import { redirectUri } from "@/server/services/connections";

export const runtime = "nodejs";

/** Starts "Connect Gmail / Outlook": redirects to the provider's consent screen. */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const base = env().APP_URL;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${base}/sign-in`);
  if (!isMailProviderId(provider) || !mailProvider(provider).configured()) return NextResponse.redirect(`${base}/email?connect_error=unavailable`);

  const pkce = newPkce();
  const state = signState({ userId: user.id, provider, verifier: pkce.verifier });
  (await cookies()).set(`lifeos_mail_pkce_${provider}`, pkce.verifier, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/api/connections",
    maxAge: 600,
  });
  return NextResponse.redirect(mailProvider(provider).authorizeUrl({ state, codeChallenge: pkce.challenge, redirectUri: redirectUri(provider) }));
}
