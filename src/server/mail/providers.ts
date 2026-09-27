import { env } from "@/server/env";

/**
 * Read-only mailbox access for "Connect Gmail / Outlook".
 * Scopes are the narrowest that let us read receipts: Gmail read-only and
 * Microsoft Mail.Read. We never send, delete or modify mail.
 */

export type MailProviderId = "gmail" | "outlook";

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[] };
export type Candidate = { id: string; receivedAt: Date; subject: string; from: string };

export interface MailProvider {
  id: MailProviderId;
  label: string;
  configured(): boolean;
  authorizeUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  profileEmail(accessToken: string): Promise<string>;
  /** Likely receipts/orders/trials received after `since`, newest last. */
  listCandidates(accessToken: string, since: Date, limit: number): Promise<Candidate[]>;
  /** The full RFC 822 message. */
  fetchRaw(accessToken: string, id: string): Promise<Buffer>;
  revoke(token: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly authExpired = false,
  ) {
    super(message);
  }
}

async function http(url: string, init: RequestInit & { accessToken?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401 || res.status === 403) throw new ProviderError(`auth ${res.status}`, true);
  if (!res.ok) throw new ProviderError(`${new URL(url).host} ${res.status}`);
  return res;
}

async function tokenRequest(url: string, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !j.access_token) throw new ProviderError(`token ${res.status} ${j.error ?? ""}`.trim(), j.error === "invalid_grant");
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000), scopes: (j.scope ?? "").split(/\s+/).filter(Boolean) };
}

/** Subjects worth downloading; the local relevance filter still decides. */
const SUBJECT_TERMS = ["receipt", "order", "invoice", "trial", "renewal", "renews", "subscription", "credit", "warranty", "refund", "return", "confirmation", "shipped", "bill", "payment"];

// ───────────────────────────── Gmail ─────────────────────────────

const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"];

const gmail: MailProvider = {
  id: "gmail",
  label: "Gmail",
  configured() {
    const e = env();
    return !!((e.GMAIL_CLIENT_ID || e.GOOGLE_CLIENT_ID) && (e.GMAIL_CLIENT_SECRET || e.GOOGLE_CLIENT_SECRET));
  },
  authorizeUrl({ state, codeChallenge, redirectUri }) {
    const e = env();
    const q = new URLSearchParams({
      client_id: (e.GMAIL_CLIENT_ID || e.GOOGLE_CLIENT_ID)!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  exchangeCode({ code, codeVerifier, redirectUri }) {
    const e = env();
    return tokenRequest("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: (e.GMAIL_CLIENT_ID || e.GOOGLE_CLIENT_ID)!,
      client_secret: (e.GMAIL_CLIENT_SECRET || e.GOOGLE_CLIENT_SECRET)!,
    });
  },
  refresh(refreshToken) {
    const e = env();
    return tokenRequest("https://oauth2.googleapis.com/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: (e.GMAIL_CLIENT_ID || e.GOOGLE_CLIENT_ID)!,
      client_secret: (e.GMAIL_CLIENT_SECRET || e.GOOGLE_CLIENT_SECRET)!,
    });
  },
  async profileEmail(accessToken) {
    const j = (await (await http("https://gmail.googleapis.com/gmail/v1/users/me/profile", { accessToken })).json()) as { emailAddress?: string };
    if (!j.emailAddress) throw new ProviderError("no email on profile");
    return j.emailAddress;
  },
  async listCandidates(accessToken, since, limit) {
    const q = `after:${Math.floor(since.getTime() / 1000)} subject:(${SUBJECT_TERMS.join(" OR ")}) -category:social -category:promotions`;
    const out: Candidate[] = [];
    let pageToken: string | undefined;
    while (out.length < limit) {
      const params = new URLSearchParams({ q, maxResults: String(Math.min(100, limit - out.length)) });
      if (pageToken) params.set("pageToken", pageToken);
      const j = (await (await http(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { accessToken })).json()) as { messages?: { id: string }[]; nextPageToken?: string };
      for (const m of j.messages ?? []) {
        const meta = (await (
          await http(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, { accessToken })
        ).json()) as { internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };
        const h = (n: string) => meta.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
        out.push({ id: m.id, receivedAt: new Date(Number(meta.internalDate ?? Date.now())), subject: h("subject"), from: h("from") });
      }
      pageToken = j.nextPageToken;
      if (!pageToken) break;
    }
    return out.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  },
  async fetchRaw(accessToken, id) {
    const j = (await (await http(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`, { accessToken })).json()) as { raw?: string };
    if (!j.raw) throw new ProviderError("empty message");
    return Buffer.from(j.raw, "base64url");
  },
  async revoke(token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
  },
};

// ───────────────────────────── Outlook / Microsoft 365 ─────────────────────────────

const MS_SCOPES = ["offline_access", "openid", "email", "User.Read", "Mail.Read"];
const MS = "https://login.microsoftonline.com/common/oauth2/v2.0";

const outlook: MailProvider = {
  id: "outlook",
  label: "Outlook",
  configured() {
    const e = env();
    return !!(e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET);
  },
  authorizeUrl({ state, codeChallenge, redirectUri }) {
    const q = new URLSearchParams({
      client_id: env().MICROSOFT_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: MS_SCOPES.join(" "),
      prompt: "select_account",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${MS}/authorize?${q}`;
  },
  exchangeCode({ code, codeVerifier, redirectUri }) {
    const e = env();
    return tokenRequest(`${MS}/token`, { grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: e.MICROSOFT_CLIENT_ID!, client_secret: e.MICROSOFT_CLIENT_SECRET!, scope: MS_SCOPES.join(" ") });
  },
  refresh(refreshToken) {
    const e = env();
    return tokenRequest(`${MS}/token`, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: e.MICROSOFT_CLIENT_ID!, client_secret: e.MICROSOFT_CLIENT_SECRET!, scope: MS_SCOPES.join(" ") });
  },
  async profileEmail(accessToken) {
    const j = (await (await http("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { accessToken })).json()) as { mail?: string; userPrincipalName?: string };
    const email = j.mail || j.userPrincipalName;
    if (!email) throw new ProviderError("no email on profile");
    return email;
  },
  async listCandidates(accessToken, since, limit) {
    const out: Candidate[] = [];
    const params = new URLSearchParams({
      $filter: `receivedDateTime gt ${since.toISOString()}`,
      $select: "id,subject,from,receivedDateTime,inferenceClassification",
      $orderby: "receivedDateTime asc",
      $top: "50",
    });
    let url: string | undefined = `https://graph.microsoft.com/v1.0/me/messages?${params}`;
    const want = new RegExp(`\\b(${SUBJECT_TERMS.join("|")})`, "i");
    let scanned = 0;
    while (url && out.length < limit && scanned < limit * 10) {
      const j = (await (await http(url, { accessToken })).json()) as {
        value?: { id: string; subject?: string; receivedDateTime: string; from?: { emailAddress?: { name?: string; address?: string } } }[];
        "@odata.nextLink"?: string;
      };
      for (const m of j.value ?? []) {
        scanned++;
        if (!want.test(m.subject ?? "")) continue;
        const f = m.from?.emailAddress;
        out.push({ id: m.id, receivedAt: new Date(m.receivedDateTime), subject: m.subject ?? "", from: f?.address ? `${f.name ?? ""} <${f.address}>`.trim() : "" });
        if (out.length >= limit) break;
      }
      url = j["@odata.nextLink"];
    }
    return out;
  },
  async fetchRaw(accessToken, id) {
    const res = await http(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}/$value`, { accessToken });
    return Buffer.from(await res.arrayBuffer());
  },
  async revoke() {
    // Microsoft has no token revocation endpoint for this flow; we delete our copy.
  },
};

const registry: Record<MailProviderId, MailProvider> = { gmail, outlook };

/** Tests swap in a fake provider here. */
export function setMailProviderForTests(id: MailProviderId, p: MailProvider | null) {
  registry[id] = p ?? (id === "gmail" ? gmail : outlook);
}

export function mailProvider(id: MailProviderId): MailProvider {
  return registry[id];
}

export function isMailProviderId(s: string): s is MailProviderId {
  return s === "gmail" || s === "outlook";
}
