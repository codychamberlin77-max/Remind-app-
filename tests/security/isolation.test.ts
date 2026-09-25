import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema, withUser } from "@/server/db/client";
import { todayIn } from "@/server/extraction/dates";
import { ingest } from "@/server/ingestion/ingest";
import { buildSample } from "@/server/samples";
import { deleteAccount, deleteAllData } from "@/server/services/account";
import { deleteDocument, getDocument, getDocumentFile, listDocuments } from "@/server/services/documents";
import { editFact, getDashboard, getItem, setActionStatus } from "@/server/services/items";
import { createReminder, listReminders } from "@/server/services/reminders";
import { search } from "@/server/services/search";
import { objectStore } from "@/server/storage/objectStore";
import { adminPool, createUser, resetDb } from "../helpers/db";

async function seed(userId: string, id: "receipt" | "trial" | "credit" = "receipt") {
  const s = await buildSample(id, todayIn("America/New_York"));
  const r = await ingest({ userId, source: "upload", bytes: s.bytes, filename: s.filename });
  if (r.status !== "accepted") throw new Error(r.status);
  const dash = await getDashboard(userId);
  const action = [...dash.needsAttention, ...dash.comingUp, ...dash.later][0]!;
  return { documentId: r.documentId, itemId: action.itemId, actionId: action.actionId };
}

describe("cross-user isolation at the service layer", () => {
  beforeEach(resetDb);

  it("user B gets not-found for every read and write on user A's data", async () => {
    const a = await createUser();
    const b = await createUser();
    const { documentId, itemId, actionId } = await seed(a.id);

    await expect(getDocument(b.id, documentId)).rejects.toThrow("not found");
    await expect(getDocumentFile(b.id, documentId)).rejects.toThrow("not found");
    await expect(getItem(b.id, itemId)).rejects.toThrow("not found");
    await expect(editFact(b.id, itemId, "return_deadline", { valueDate: "2030-01-01" })).rejects.toThrow("not found");
    await expect(setActionStatus(b.id, actionId, "done")).rejects.toThrow("not found");
    await expect(createReminder(b.id, { actionId, preset: "tomorrow" })).rejects.toThrow("not found");
    await expect(deleteDocument(b.id, documentId)).rejects.toThrow("not found");

    expect(await listDocuments(b.id)).toEqual([]);
    expect((await getDashboard(b.id)).needsAttention).toEqual([]);
    expect((await search(b.id, "Samsung")).results).toEqual([]);
    expect((await search(b.id, "How much am I currently tracking?")).total?.cents).toBe(0);

    // A's data is untouched.
    expect((await getItem(a.id, itemId)).item.id).toBe(itemId);
  });

  it("stored blobs are keyed per user, and there is no public URL path", async () => {
    const a = await createUser();
    const { documentId } = await seed(a.id);
    const [doc] = await withUser(a.id, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)));
    expect(doc!.storageKey).toMatch(new RegExp(`^u/${a.id}/[0-9a-f-]{36}$`));
    expect(doc!.storageKey).not.toContain("bestbuy");
    expect(Object.keys(objectStore())).not.toContain("publicUrl");
  });

  it("credit codes never persist in plaintext outside the encrypted column", async () => {
    const a = await createUser();
    await seed(a.id, "credit");
    const { rows } = await adminPool().query(
      `select d.text_content, e.raw_output::text raw, e.output::text out, f.value_text
       from documents d join document_extractions e on e.document_id = d.id join item_facts f on f.user_id = d.user_id
       where d.user_id = $1`,
      [a.id],
    );
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toContain("0062198473516");
    }
    const { rows: enc } = await adminPool().query(`select credit_reference_enc from travel_credits where user_id = $1`, [a.id]);
    expect(enc[0].credit_reference_enc).toBeInstanceOf(Buffer);
  });
});

describe("deletion", () => {
  beforeEach(resetDb);

  it("deleting a document removes the blob and every derived row", async () => {
    const a = await createUser();
    const { documentId, actionId } = await seed(a.id);
    await createReminder(a.id, { actionId, preset: "tomorrow" });
    const [doc] = await withUser(a.id, (tx) => tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)));
    expect(await objectStore().exists(doc!.storageKey)).toBe(true);

    await deleteDocument(a.id, documentId);

    expect(await objectStore().exists(doc!.storageKey)).toBe(false);
    for (const t of ["documents", "document_extractions", "items", "item_facts", "purchases", "warranties", "protections", "actions", "reminders", "item_categories"]) {
      const { rows } = await adminPool().query(`select count(*)::int n from ${t} where user_id = $1`, [a.id]);
      expect(rows[0].n, t).toBe(0);
    }
    const { rows: audit } = await adminPool().query(`select event, metadata from audit_events where user_id = $1 and event = 'document.deleted'`, [a.id]);
    expect(audit).toHaveLength(1);
  });

  it("delete-all-data keeps the account but removes everything else", async () => {
    const a = await createUser();
    await seed(a.id);
    await seed(a.id, "trial");
    await deleteAllData(a.id);
    const { rows } = await adminPool().query(
      `select (select count(*) from documents where user_id=$1)::int d, (select count(*) from items where user_id=$1)::int i, (select count(*) from users where id=$1)::int u`,
      [a.id],
    );
    expect(rows[0]).toEqual({ d: 0, i: 0, u: 1 });
    const store = objectStore() as unknown as { deletePrefix: (p: string) => Promise<number> };
    expect(await store.deletePrefix(`u/${a.id}/`)).toBe(0);
  });

  it("account deletion hard-deletes all user rows and files; audit trail loses identity", async () => {
    const a = await createUser();
    const b = await createUser();
    const { actionId } = await seed(a.id);
    await seed(b.id);
    await createReminder(a.id, { actionId, preset: "tomorrow" });

    await deleteAccount(a.id);

    const { rows: tables } = await adminPool().query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns where table_schema='public' and column_name='user_id'`,
    );
    for (const { table_name } of tables) {
      const { rows } = await adminPool().query(`select count(*)::int n from "${table_name}" where user_id = $1`, [a.id]);
      expect(rows[0].n, table_name).toBe(0);
    }
    expect((await adminPool().query(`select count(*)::int n from users where id=$1`, [a.id])).rows[0].n).toBe(0);
    expect((await adminPool().query(`select count(*)::int n from audit_events where user_id is null and event='account.deleted'`)).rows[0].n).toBe(1);
    const store = objectStore() as unknown as { deletePrefix: (p: string) => Promise<number> };
    expect(await store.deletePrefix(`u/${a.id}/`)).toBe(0);

    // User B is unaffected.
    expect((await listDocuments(b.id)).length).toBe(1);
  });
});

describe("audit trail", () => {
  beforeEach(resetDb);
  it("never contains document content", async () => {
    const a = await createUser();
    await seed(a.id);
    const { rows } = await adminPool().query(`select metadata::text m from audit_events where user_id=$1`, [a.id]);
    const all = rows.map((r) => r.m).join(" ");
    expect(all).not.toMatch(/samsung|1,611|best buy|4821/i);
  });
});

void sql;
void db;
void listReminders;
