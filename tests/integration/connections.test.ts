import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMailProviderForTests, type Candidate, type MailProvider } from "@/server/mail/providers";
import { completeConnection, disconnect, listConnections, syncConnection } from "@/server/services/connections";
import { adminPool, createUser, resetDb } from "../helpers/db";

const recent = (days: number) => new Date(Date.now() - days * 86_400_000);

function eml(id: string, subject: string, from: string, body: string, date: Date) {
  return Buffer.from(`From: ${from}\r\nTo: me@gmail.com\r\nSubject: ${subject}\r\nDate: ${date.toUTCString()}\r\nMessage-ID: <${id}@mail.example>\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`);
}

/** A fake Gmail with a few messages. */
function fakeGmail() {
  const inbox: (Candidate & { raw: Buffer })[] = [
    { id: "m1", receivedAt: recent(5), subject: "Your Best Buy order #BBY01-555", from: "Best Buy <BestBuyInfo@emailinfo.bestbuy.com>", raw: eml("m1", "Your Best Buy order #BBY01-555", "Best Buy <BestBuyInfo@emailinfo.bestbuy.com>", "Thanks for your order.\r\nSamsung 65\" TV\r\nOrder total: $1,299.99", recent(5)) },
    { id: "m2", receivedAt: recent(4), subject: "Lunch on Friday?", from: "Pal <pal@gmail.com>", raw: eml("m2", "Lunch on Friday?", "Pal <pal@gmail.com>", "noon?", recent(4)) },
    { id: "m3", receivedAt: recent(3), subject: "Flash sale: 40% off your next order", from: "Deals <news@store.example>", raw: eml("m3", "Flash sale", "Deals <news@store.example>", "Shop now", recent(3)) },
  ];
  let tokenN = 0;
  const p: MailProvider & { calls: { fetchRaw: string[]; refresh: number; revoked: string[] }; failRefresh?: boolean } = {
    id: "gmail",
    label: "Gmail",
    calls: { fetchRaw: [], refresh: 0, revoked: [] },
    configured: () => true,
    authorizeUrl: () => "https://accounts.example/auth",
    exchangeCode: async () => ({ accessToken: "access-1", refreshToken: "refresh-SECRET", expiresAt: new Date(Date.now() + 3_600_000), scopes: ["gmail.readonly"] }),
    refresh: async () => {
      p.calls.refresh++;
      if (p.failRefresh) {
        const { ProviderError } = await import("@/server/mail/providers");
        throw new ProviderError("token 400 invalid_grant", true);
      }
      return { accessToken: `access-${++tokenN + 1}`, refreshToken: null, expiresAt: new Date(Date.now() + 3_600_000), scopes: [] };
    },
    profileEmail: async () => "Me@Gmail.com",
    listCandidates: async (_t, since) => inbox.filter((m) => m.receivedAt > since).map(({ raw: _raw, ...c }) => c),
    fetchRaw: async (_t, id) => {
      p.calls.fetchRaw.push(id);
      return inbox.find((m) => m.id === id)!.raw;
    },
    revoke: async (t) => {
      p.calls.revoked.push(t);
    },
  };
  return { p, inbox };
}

describe("Connect Gmail / Outlook", () => {
  beforeEach(resetDb);
  afterEach(() => {
    setMailProviderForTests("gmail", null);
    vi.restoreAllMocks();
  });

  it("stores tokens encrypted and imports only receipt-like mail", async () => {
    const { p } = fakeGmail();
    setMailProviderForTests("gmail", p);
    const u = await createUser();
    const id = await completeConnection(u.id, "gmail", { code: "c", codeVerifier: "v" });

    const { rows } = await adminPool().query(`select email_address, refresh_token_enc, access_token_enc from email_connections where id = $1`, [id]);
    expect(rows[0].email_address).toBe("me@gmail.com");
    expect(Buffer.from(rows[0].refresh_token_enc).toString("latin1")).not.toContain("refresh-SECRET");

    const r = await syncConnection(u.id, id);
    expect(r).toMatchObject({ scanned: 3, imported: 1 });
    // The personal email was judged on subject/sender alone and never downloaded.
    expect(p.calls.fetchRaw).not.toContain("m2");
    const docs = await adminPool().query(`select source from documents where user_id = $1`, [u.id]);
    expect(docs.rows).toEqual([{ source: "gmail" }]);

    const [conn] = await listConnections(u.id);
    expect(conn).toMatchObject({ provider: "gmail", status: "active", imported: 1 });
    expect(conn!.lastSyncedAt).not.toBeNull();
  });

  it("doesn't re-import on the next sync, and refreshes expired access", async () => {
    const { p, inbox } = fakeGmail();
    setMailProviderForTests("gmail", p);
    const u = await createUser();
    const id = await completeConnection(u.id, "gmail", { code: "c", codeVerifier: "v" });
    await syncConnection(u.id, id);
    await adminPool().query(`update email_connections set access_expires_at = now() - interval '1 minute' where id = $1`, [id]);

    inbox.push({ id: "m4", receivedAt: new Date(), subject: "Your free trial ends Friday", from: "StreamMax <billing@streammax.example>", raw: eml("m4", "Your free trial ends Friday", "StreamMax <billing@streammax.example>", "Your trial converts to $19.99/mo on Friday.", new Date()) });
    const r2 = await syncConnection(u.id, id);
    expect(p.calls.refresh).toBe(1);
    expect(r2).toMatchObject({ imported: 1 });
    expect((await adminPool().query(`select count(*)::int n from documents where user_id = $1`, [u.id])).rows[0].n).toBe(2);
  });

  it("asks the user to reconnect when access is revoked at Google", async () => {
    const { p } = fakeGmail();
    p.failRefresh = true;
    setMailProviderForTests("gmail", p);
    const u = await createUser();
    const id = await completeConnection(u.id, "gmail", { code: "c", codeVerifier: "v" });
    await adminPool().query(`update email_connections set access_expires_at = now() - interval '1 minute' where id = $1`, [id]);
    expect(await syncConnection(u.id, id)).toBeNull();
    expect((await listConnections(u.id))[0]).toMatchObject({ status: "error", lastError: "reconnect_required" });
  });

  it("disconnect revokes and deletes access but keeps what was imported", async () => {
    const { p } = fakeGmail();
    setMailProviderForTests("gmail", p);
    const u = await createUser();
    const id = await completeConnection(u.id, "gmail", { code: "c", codeVerifier: "v" });
    await syncConnection(u.id, id);
    await disconnect(u.id, id);
    expect(p.calls.revoked).toEqual(["refresh-SECRET"]);
    expect(await listConnections(u.id)).toHaveLength(0);
    expect((await adminPool().query(`select count(*)::int n from email_connections`)).rows[0].n).toBe(0);
    expect((await adminPool().query(`select count(*)::int n from documents where user_id = $1`, [u.id])).rows[0].n).toBe(1);
  });

  it("never lets one user see or sync another user's inbox", async () => {
    const { p } = fakeGmail();
    setMailProviderForTests("gmail", p);
    const a = await createUser();
    const b = await createUser();
    const id = await completeConnection(a.id, "gmail", { code: "c", codeVerifier: "v" });
    expect(await listConnections(b.id)).toHaveLength(0);
    expect(await syncConnection(b.id, id)).toBeNull();
    await expect(disconnect(b.id, id)).rejects.toThrow();
    expect(await listConnections(a.id)).toHaveLength(1);
  });
});
