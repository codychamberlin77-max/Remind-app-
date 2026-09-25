# LIFEOS — MVP Architecture Proposal

Status: **proposal, awaiting approval**. Nothing here is implemented yet.

The MVP proves one loop:

```
Upload → Understand → Extract → Identify what matters → Create actions → Remind → User completes
```

Everything below serves that loop, or keeps later phases (email ingestion, agent actions) from requiring a rewrite.

---

## 0. Current repository state

The repository is empty (no commits, no files), so there's no existing infrastructure to keep. Everything below is a new build.

---

## 1. Technical architecture

```
┌──────────────────────────── Next.js app (web process) ────────────────────────────┐
│  Marketing pages   Auth pages   App (dashboard, items, documents, search, settings)│
│  Route handlers: upload, file streaming, SSE progress, auth                        │
│  Server actions: mark done, set reminder, dismiss, delete                          │
│                                                                                    │
│  server/ (framework-agnostic domain code)                                          │
│   authz ─ scoped repositories: every query takes a userId, no exceptions           │
│   ingestion ─ validate → store → enqueue                                           │
│   extraction ─ normalize → classify → extract → validate → ground                  │
│   derivation ─ deterministic rules: deadlines, actions, priority                   │
│   reminders ─ scheduler + channel adapters                                         │
│   search ─ structured query + Postgres full-text                                   │
│   ai ─ AIProvider interface (Anthropic, OpenAI, Mock)                              │
└──────────────┬───────────────────────────────┬────────────────────────────────────┘
               │                               │
        ┌──────▼──────┐                 ┌──────▼──────────┐
        │ PostgreSQL  │◄── job queue ───│ Worker process  │  (same codebase, runs
        │ (+ RLS)     │   (pg-boss)     │ extraction,     │   pipeline + reminder
        └─────────────┘                 │ reminders, purge│   dispatch)
                                        └──────┬──────────┘
        ┌─────────────────────┐                │
        │ Private object store│◄───────────────┘
        │ (S3 / R2 / MinIO)   │
        └─────────────────────┘
```

Key decisions:

- **One repo, two processes.** The web process and the worker come from the same TypeScript codebase. Extraction takes 5–30s and can't run inside a request.
- **Postgres is also the queue** (pg-boss). That means one fewer vendor and one fewer place where user data lives. I'm deliberately not using Inngest or Trigger.dev: their step outputs are stored on their infrastructure, so document text would leave our boundary.
- **Domain logic lives in `src/server/`**, not in route files, so the email ingestion path in Phase 2 can call the same pipeline as upload.
- **The LLM extracts facts and code computes consequences.** The model never computes a deadline. It reports "purchase date: Sept 10" and "return policy stated: 15 days", and the rules engine computes Sept 25. This is the most important architectural choice for preventing hallucinated deadlines.

---

## 2. Recommended stack

| Concern | Choice | Why / tradeoff |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Standard choice. Server components keep data access on the server. |
| DB | **PostgreSQL 16** | Relational data, full-text search, row-level security, jsonb for long-tail fields. |
| ORM | **Drizzle** | Close to SQL, no binary engine, supports RLS and raw SQL well, and its schema is plain TypeScript. Prisma has a nicer migration experience, but its query engine and weaker RLS story make it the wrong fit here. |
| Auth | **Better Auth** (email/password + Google) | Self-hosted and stores sessions in *our* Postgres. Clerk is faster to set up, but it puts user identity with a third party, which doesn't fit a privacy-positioned product. Auth.js v5 is weaker for email/password. |
| Object storage | **S3-compatible** (Cloudflare R2 or AWS S3; MinIO locally) | Private bucket, SSE at rest, no public ACLs. |
| Queue | **pg-boss** | Postgres-backed, with retries, scheduling, and singleton jobs. |
| Validation | **Zod** | Shared between API input, LLM output, and DB detail payloads. |
| Styling | **Tailwind CSS + Radix primitives** (shadcn-style, heavily restyled) | Accessible primitives with our own visual language. |
| Motion | **Framer Motion** (sparingly) | For the reveal moment and card transitions. |
| PDF text | **unpdf** (pdf.js) | Text-layer extraction runs locally, so text PDFs don't need vision. |
| Images | **sharp** | Converts HEIC to JPEG, strips EXIF/GPS, and downsizes before sending to the model. |
| Email files | **mailparser** | Parses `.eml` uploads now and the Gmail path later. |
| AI | **Anthropic (default)**, OpenAI adapter, Mock provider | Behind an `AIProvider` interface. Models are configurable through env. |
| Email (reminders) | **Resend** or Postmark behind a `ReminderChannel` interface | In-app notifications ship first and email second. Push and SMS are interface-only. |
| Testing | **Vitest** (unit + integration against real Postgres), **Playwright** (e2e) | Integration tests run against a real DB because the RLS/authz tests must hit real Postgres. |
| Hosting | **Railway / Render / Fly** (web + worker + Postgres), R2 for files | A long-running worker is simpler there than on Vercel. We can move later. |
| Local dev | `docker compose` for Postgres + MinIO | Setup should be one command. |

---

## 3. Database schema

Conventions:
- UUIDv7 primary keys, so IDs can't be enumerated.
- Money is stored as `amount_cents bigint` + `currency char(3)`.
- Dates that are calendar dates (deadlines) are stored as `date`, not `timestamptz`. A deadline is a day, and timezone math on dates creates off-by-one bugs.
- Every user-owned table carries `user_id` with an FK to `users ON DELETE CASCADE`.
- Every user-owned table has an index that leads with `user_id`.
- Every user-owned table has an RLS policy `user_id = current_setting('app.user_id')::uuid`.

### Design choice: a shared `items` table plus typed detail tables

The user sees *items* (a TV, a subscription, a credit) and *actions* (return it, cancel it, use it). Instead of four unrelated tables, I'm proposing a supertype table:

- **`items`** holds what every card needs: title, merchant, amount, kind, confidence, and source document.
- **Typed detail tables** (`purchases`, `subscriptions`, `warranties`, `travel_credits`) hold queryable, type-specific fields. They share the item's primary key.
- **Long-tail kinds** (bill, appointment, insurance, vehicle, other) use `items.details jsonb`, validated by a Zod schema per kind. When one of them earns real queries, it gets promoted to a table.

This keeps questions like "how much money do I have in active warranties?" as plain SQL, and adding a new kind doesn't require a migration.

```sql
-- Auth (managed by Better Auth): users, sessions, accounts, verifications
users(id, email, name, email_verified, image, plan text default 'free',
      timezone text default 'America/New_York', created_at, updated_at)

documents(
  id, user_id,
  storage_key text,            -- random, no filename, no PII
  original_filename text,      -- display only
  mime_type text,              -- sniffed from magic bytes, not trusted from client
  size_bytes int,
  sha256 char(64),             -- dedup
  source text,                 -- 'upload' | 'email_forward' | 'gmail' (later)
  status text,                 -- 'queued'|'processing'|'processed'|'needs_review'|'failed'|'unsupported'
  failure_reason text,
  text_content text,           -- normalized text, used for search + re-extraction
  search_vector tsvector,      -- generated
  page_count int,
  created_at, processed_at,
  UNIQUE (user_id, sha256)     -- duplicate upload → return the existing document
)

document_extractions(
  id, user_id, document_id,
  document_type text,          -- 'purchase_receipt' | 'subscription' | ...
  classification_confidence real,
  provider text, model text, prompt_version text, schema_version text,
  output jsonb,                -- validated extraction (fields carry evidence + confidence)
  warnings jsonb,              -- grounding failures, sanity-check failures
  overall_confidence real,
  input_tokens int, output_tokens int, latency_ms int,
  created_at
)  -- append-only: re-extraction creates a new row; items point at the one used

categories(id, slug unique, name, sort_order)            -- system-defined; seeded
-- (user-defined categories later = add nullable user_id)

items(
  id, user_id, document_id NULL, extraction_id NULL,
  kind text,                   -- purchase|subscription|warranty|travel_credit|bill|appointment|insurance|vehicle|document|other
  title text, merchant text,
  amount_cents bigint NULL, currency char(3) NULL,
  primary_date date NULL,      -- the date that matters for display (purchase date, renewal, expiry)
  details jsonb,               -- kind-specific long-tail fields (Zod-validated)
  confidence real,
  needs_review boolean,        -- true if any key field is low-confidence/ungrounded
  state text,                  -- 'active'|'saved'|'archived'|'dismissed'
  user_importance smallint default 0,  -- -1 / 0 / +1 user override
  search_vector tsvector,
  created_at, updated_at, reviewed_at NULL
)
item_categories(item_id, category_id, PRIMARY KEY(item_id, category_id))

purchases(item_id PK/FK, user_id, purchase_date date, order_number text,
          subtotal_cents, tax_cents, total_cents, payment_last4 char(4),
          return_deadline date NULL,
          return_deadline_basis text,   -- 'stated_on_document'|'merchant_policy_estimate'|'user_entered'|'unknown'
          line_items jsonb)             -- [{name, qty, unit_cents, total_cents}]

subscriptions(item_id PK/FK, user_id, service_name, amount_cents, currency,
              billing_period text,       -- 'monthly'|'annual'|'weekly'|'other'
              trial_ends_on date NULL, next_renewal_on date NULL,
              status text)               -- 'trial'|'active'|'cancelled'|'unknown'

warranties(item_id PK/FK, user_id, covered_item_id NULL -> items,
           provider text, starts_on date NULL, ends_on date NULL,
           duration_months int NULL, ends_on_basis text, coverage_summary text)

travel_credits(item_id PK/FK, user_id, carrier text, amount_cents, currency,
               expires_on date NULL, expires_on_basis text,
               credit_reference_enc bytea)   -- app-level encrypted

actions(
  id, user_id, item_id, document_id NULL,
  type text,                  -- 'return'|'cancel_trial'|'review_renewal'|'use_credit'|'pay_bill'|'file_claim'|'attend'|'review_extraction'
  title text, description text,
  due_on date NULL,
  due_certainty text,         -- 'confirmed'|'estimated'|'unknown'
  estimated_value_cents bigint NULL,
  consequence text,           -- 'lose_money'|'charged'|'lose_coverage'|'late_fee'|'inconvenience'
  priority_score real, priority_reason text,   -- recomputed daily + on change
  suggested_action text,
  confidence real,
  status text,                -- 'open'|'snoozed'|'done'|'dismissed'
  snoozed_until date NULL, completed_at NULL,
  created_at, updated_at
)
INDEX (user_id, status, priority_score DESC)
INDEX (user_id, due_on)

reminders(
  id, user_id, action_id,
  remind_at timestamptz,      -- resolved from preset + user timezone
  preset text,                -- 'today'|'tomorrow'|'3_days_before'|'1_week_before'|'custom'
  channels text[],            -- {'in_app','email'} now; 'push','sms' later
  status text,                -- 'scheduled'|'sent'|'failed'|'cancelled'
  sent_at NULL, attempts int, created_at
)
INDEX (status, remind_at)     -- worker polling

notifications(id, user_id, reminder_id NULL, action_id NULL,
              channel text, title text, body text,
              delivered_at, read_at NULL, created_at)

audit_events(
  id, user_id NULL,           -- nulled (not deleted) on account deletion
  actor text,                 -- 'user'|'system'|'worker'
  event text,                 -- 'document.uploaded','document.deleted','item.viewed_source','account.deleted', ...
  entity_type text, entity_id uuid,
  metadata jsonb,             -- NEVER document content or extracted PII
  ip_hash text, created_at
)

-- Designed now, built in Phase 2:
email_connections(id, user_id, provider, email_address,
                  refresh_token_enc bytea, scopes text[],
                  sync_cursor text, status, last_synced_at)
inbound_messages(id, user_id, connection_id, provider_message_id,
                 relevance_score real, relevance_reason text,
                 status 'skipped'|'ingested', document_id NULL)
                 -- skipped messages store ONLY ids + score, never content
```

**Entitlements:** a small `entitlements.ts` module maps `users.plan` to limits (for example `{maxDocuments: 25}`). Payments aren't built. Pricing lives in exactly one file.

---

## 4. Folder structure

```
/
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx, privacy/, security/
│  │  ├─ (auth)/sign-in/, sign-up/
│  │  ├─ (app)/
│  │  │  ├─ layout.tsx                  # requires session
│  │  │  ├─ home/                       # dashboard
│  │  │  ├─ welcome/                    # first-run upload
│  │  │  ├─ items/[id]/                 # item detail
│  │  │  ├─ documents/ , documents/[id]/
│  │  │  ├─ search/
│  │  │  └─ settings/                   # profile, delete data, delete account
│  │  └─ api/
│  │     ├─ auth/[...all]/route.ts
│  │     ├─ documents/route.ts          # POST upload
│  │     ├─ documents/[id]/file/route.ts# authorized streaming of original file
│  │     └─ documents/[id]/events/route.ts  # SSE pipeline progress
│  ├─ components/ (ui/, dashboard/, items/, upload/, marketing/)
│  ├─ server/
│  │  ├─ db/          schema/, client.ts, withUser.ts (sets RLS context), migrations/
│  │  ├─ auth/
│  │  ├─ repos/       documents.ts, items.ts, actions.ts, ... (all take userId)
│  │  ├─ storage/     objectStore.ts (S3 adapter), keys.ts
│  │  ├─ ingestion/   validateFile.ts, ingest.ts, normalize/{pdf,image,email,text}.ts
│  │  ├─ ai/          provider.ts, providers/{anthropic,openai,mock}.ts
│  │  ├─ extraction/  pipeline.ts, classify.ts, extract.ts, grounding.ts, sanity.ts,
│  │  │               schemas/{common,receipt,subscription,warranty,travelCredit,...}.ts,
│  │  │               prompts/ (versioned)
│  │  ├─ derivation/  deriveItems.ts, rules/{purchase,subscription,warranty,travelCredit,...}.ts,
│  │  │               merchantPolicies.ts, dates.ts
│  │  ├─ priority/    score.ts, explain.ts
│  │  ├─ reminders/   schedule.ts, dispatch.ts, channels/{inApp,email,push,sms}.ts
│  │  ├─ search/      parseQuery.ts, execute.ts
│  │  ├─ jobs/        queue.ts, worker.ts, handlers/
│  │  ├─ audit/       log.ts
│  │  ├─ privacy/     redact.ts, crypto.ts, deletion.ts
│  │  └─ entitlements.ts
│  └─ lib/            money.ts, dates.ts, cn.ts
├─ tests/
│  ├─ fixtures/documents/      # synthetic receipts, emails, PDFs, images
│  ├─ fixtures/golden/         # expected extraction per fixture
│  ├─ unit/  integration/  security/  e2e/
│  └─ evals/                   # live-model eval runner (not in CI by default)
├─ docker-compose.yml  drizzle.config.ts  .env.example
└─ docs/ARCHITECTURE.md
```

---

## 5. AI extraction architecture

### Pipeline (one job per document, each stage idempotent)

1. **Validate** (sync, in the upload request)
   - Check magic bytes and the type allowlist. Enforce a 20 MB size cap.
   - Compute the sha256 and dedup per user.
2. **Normalize** to `{text, pages: image[]?}`
   - Text PDFs are parsed locally.
   - Scanned PDFs and images become downscaled page images, with EXIF stripped.
   - `.eml` files are parsed to headers + text body. HTML is converted to text.
   - Most documents never need vision. That's cheaper, faster, and sends less data out.
3. **Redact** before any external call
   - Mask full card numbers (keep last 4), SSNs, and bank/routing numbers.
   - Remove the user's own name and email from the text.
   - The model doesn't need these fields to find a deadline.
4. **Classify**
   - A cheap/fast model returns `{document_type, confidence, is_actionable}`.
   - Non-actionable documents (a random screenshot) are filed as "Document" with no actions. The system doesn't invent work.
5. **Extract**
   - A strong model with a **type-specific Zod schema**, sent as a tool/structured-output schema.
   - Every important field uses a grounded wrapper:
     ```ts
     Field<T> = {
       value: T | null,
       evidence: string | null,      // verbatim quote from the document
       confidence: number,           // 0–1, model's self-report (treated as a hint, not truth)
       status: 'explicit' | 'inferred' | 'not_found'
     }
     ```
   - Dates are extracted as `{raw: "10/03/26", iso: "2026-10-03", ambiguity: "MM/DD vs DD/MM"}`.
   - The prompt says, in several ways: *null is a correct answer; never guess a date*.
6. **Validate and ground** (deterministic code, not the model)
   - Zod parse. On failure, one repair retry, then mark `needs_review`.
   - **Evidence check:** each `evidence` string must fuzzy-match the normalized text. A date with no matching evidence is downgraded to `inferred`, and its confidence is capped at 0.5.
   - **Date sanity:** a purchase date can't be in the future. A deadline must be ≥ the purchase date. The year must be plausible. Ambiguous numeric dates (03/04) are flagged unless the locale or other dates on the document resolve them.
   - **Arithmetic:** line items should sum to about the subtotal, and subtotal + tax to about the total. A mismatch adds a warning.
   - **Final confidence** is computed from grounding, sanity checks, and the model's self-report. It's never the model's number alone.
7. **Derive** (rules engine)
   - Turns the validated extraction into items and actions.
   - **Return deadline precedence:**
     1. Stated on the document → `confirmed`
     2. Otherwise, a curated `merchantPolicies` table (Best Buy 15d, Amazon 30d, Apple 14d, …) → `estimated`, shown as *"Typical Best Buy policy is 15 days. Check your receipt."*
     3. Otherwise → `unknown`, with no deadline. We show "Return window unknown" and offer "Add it".
   - Warranties follow the same pattern: stated duration → end date. Manufacturer default → estimated. Otherwise unknown.
8. **Prioritize** — see below.
9. **Persist** in one transaction. Write an audit event. Emit SSE progress.

### AIProvider interface

```ts
interface AIProvider {
  id: 'anthropic' | 'openai' | 'mock';
  generateStructured<T>(req: {
    task: 'classify' | 'extract' | 'parse_search';
    system: string;
    content: Array<{ type: 'text'; text: string } | { type: 'image'; mime: string; data: Buffer }>;
    schema: z.ZodType<T>;          // converted to JSON Schema for the provider's tool/structured output
    modelTier: 'fast' | 'strong';  // mapped to concrete model IDs via env config
  }): Promise<{ data: T; usage: Usage; model: string }>;
}
```

- The Mock provider returns golden fixtures, so every test is deterministic and needs no API key.
- Prompt and schema versions are recorded on every extraction, so we can re-run old documents when prompts improve.

### Priority model (deterministic and explainable)

```
score = urgency(days_left, due_certainty)      // steep curve: ≤3d ≈ 1.0, 7d ≈ 0.7, 30d ≈ 0.2
      × consequence_weight                    // lose_money 1.0, charged 0.8, lose_coverage 0.5, inconvenience 0.2
      × value_factor(log10(value))            // $1,299 ≫ $9.99, but log-scaled so cheap urgent things still surface
      × confidence_factor                     // estimated deadlines are dampened, but never hidden
      + user_importance_boost
```

- **Needs Attention:** open actions with score ≥ threshold, or high-consequence and due within 7 days.
- **Coming Up:** due within 60 days.
- **Recently Discovered:** items from the last 7 days that the user hasn't reviewed.
- **Saved:** items where `state = 'saved'`.

Each score produces a `priority_reason` from the dominant term, for example: *"Your $1,299 return window closes in 3 days."* or *"Trial converts to a $19.99/mo charge tomorrow."*

### Evals

- `tests/fixtures` holds about 30 synthetic documents at first, covering every case in the testing requirements.
- Each has a golden JSON file.
- CI runs the pipeline against the Mock provider (deterministic).
- `npm run eval` runs the live provider and reports field-level precision and recall, with **hallucinated dates** as a separate, zero-tolerance metric. A date we output that isn't on the document and wasn't derived by a rule counts as a failure.

---

## 6. Security and privacy architecture

**Isolation (defense in depth)**
1. **Repository layer:** every data-access function takes `userId` from the session, never from request params. Route handlers never touch the DB directly.
2. **Postgres RLS** on every user-owned table. `withUser(userId, tx => …)` runs `set_config('app.user_id', …, true)` per transaction, and the app's DB role is **not** the table owner and has no `BYPASSRLS`. A forgotten `WHERE user_id =` returns nothing instead of leaking data. The worker runs with the same per-user context.
3. Non-enumerable UUIDs. Another user's object returns **404, not 403**.

**Files**
- Private bucket with no public access. Keys are `u/{userId}/{uuidv7}`, with no filenames.
- Originals are only served through `/api/documents/[id]/file` after an ownership check. That route streams the file with the sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and `Content-Disposition: attachment` for anything that isn't an image or PDF. The alternative is a 60-second presigned URL issued after the check. Either way, no durable public URL exists.
- Allowlist: PDF, JPEG, PNG, HEIC/HEIF, WebP, EML, TXT. **SVG, HTML, and Office files with macros are rejected.**
- The type is checked by magic bytes, not by extension or client MIME type.
- 20 MB cap and a per-user upload rate limit.
- Parsers run in the worker, never in the web request. PDFs are parsed for text only, and embedded JS is never executed.
- Images are re-encoded with sharp, which strips EXIF/GPS and neutralizes polyglot files.

**Encryption**
- At rest: provider-managed disk encryption (Postgres) and SSE on the bucket. TLS everywhere.
- **Application-level envelope encryption** (AES-256-GCM, key from KMS/env) for the highest-risk fields: OAuth refresh tokens, confirmation/credit codes, and account numbers.
- Tradeoff: document text is *not* app-encrypted in the MVP, because full-text search needs it. Marketing copy will say "encrypted in transit and at rest". It will **not** say "end-to-end encrypted" or "we can't see your data".

**External AI calls**
- Send only document content, after redaction. Never send the user's name, email, or account metadata.
- Use API tiers that don't train on inputs (the default for the Anthropic and OpenAI APIs). Request zero-data-retention where available.
- No document content in application logs or error trackers. The logger has a redaction allowlist.

**Auth**
- Better Auth DB sessions in httpOnly, Secure, SameSite=Lax cookies.
- Password hashing (scrypt/argon2 via the library), email verification, and rate limits on auth endpoints.
- CSRF is covered by same-site cookies plus origin checks on mutations.

**Deletion**
- **Delete a document:** hard-delete the blob, extractions, and any items/actions derived *only* from it (FK cascade), and cancel pending reminders. An audit event records *that* it happened, not *what* it was.
- **Delete an item** without deleting the source document: also supported.
- **Delete the account:** hard-delete all rows via cascade, enqueue a blob purge for the `u/{userId}/` prefix, null out `user_id` on audit events, and revoke sessions. Backups roll off within the provider's retention window, and the privacy page will say so honestly.

**Audit:** security-relevant events (upload, view original, delete, export, sign-in, account deletion) go to `audit_events` with no content.

**Security test suite** (it must pass before we call the MVP done):
- User A → B's document, file, item, action, reminder, and search results all return 404 or empty.
- Unauthenticated → every API route returns 401.
- An RLS test runs a raw query *without* a user filter and gets zero foreign rows.
- A direct bucket URL returns 403.
- An SVG/HTML upload disguised as PNG is rejected.
- An oversized file is rejected.
- A malformed PDF fails gracefully.
- After deletion, the DB rows and the blob are gone.

---

## 7. MVP feature list

1. Landing page (hero, 4 value props, privacy section, CTA)
2. Auth: email/password + Google, profile (name, timezone), sign out
3. First-run flow: upload zone, sample documents, live processing, "We found N things"
4. Upload: drag-and-drop, multi-file, mobile camera/photo picker, duplicate detection
5. Extraction pipeline for **receipts/orders, subscriptions/trials, warranties, travel credits**, with graceful "Document" filing for everything else. Bills and appointments get basic support.
6. Actions with deterministic deadlines, certainty labels, and explained priority
7. Dashboard: Needs Attention, Coming Up, Recently Discovered, Saved, plus category filter
8. Item detail: key facts, deadline countdowns with certainty, source document viewer, actions (remind, done, dismiss, save, edit a field, delete)
9. **User corrections:** edit any extracted field in one tap. It's the backstop for AI errors and becomes a quality signal later.
10. Reminders: presets + custom, delivered **in-app** and by **email**. Push and SMS are interfaces only.
11. Search: natural-language questions → structured filters + full text, including simple aggregates ("how much in active warranties")
12. Documents list + delete. Settings: delete all data, delete account.
13. Free-plan limit enforced through entitlements (no payments)

---

## 8. What I would deliberately NOT build yet

- **Gmail/Outlook OAuth.** See risk #3. I'd ship a **forwarding address** first (`you-xxxx@in.lifeos.app`), because it's the same pipeline with no restricted OAuth scopes and the user picks exactly what we see.
- Payments/Stripe (only the entitlements hook)
- Native apps (the web app is mobile-first and installable as a PWA)
- Push and SMS delivery
- Chat interface, vector search/RAG, embeddings
- Agent actions (start return, cancel subscription)
- Bank/Plaid, calendar sync, price tracking
- User-defined categories, tags, folders
- Household/family sharing, multi-currency conversion
- Cross-document entity resolution beyond simple duplicate suggestions. The receipt + shipping email + order email "same purchase" merge is a Phase 2 problem.
- An admin dashboard (SQL + audit table for now)

---

## 9. Development sequence

Each step ends with tests passing and a working, demoable slice.

| # | Milestone | Rough size |
|---|---|---|
| 1 | Scaffold: Next.js, Tailwind, Drizzle, docker-compose (PG + MinIO), CI (lint, typecheck, test) | 0.5 day |
| 2 | Schema + migrations + RLS + `withUser` + Better Auth (email + Google) + **isolation tests** | 1–1.5 days |
| 3 | Upload: validation, storage, dedup, documents list, authorized file streaming + **file security tests** | 1 day |
| 4 | Extraction: normalize (PDF/image/eml), AIProvider + Mock + Anthropic, schemas, grounding, sanity checks, fixtures + golden tests | 2–3 days |
| 5 | Derivation + merchant policies + actions + priority scoring + tests (hallucinated-date cases) | 1.5 days |
| 6 | Dashboard, item detail, edits, done/dismiss/save — **the design pass happens here** | 2–3 days |
| 7 | First-run flow + SSE progress + sample documents + the reveal | 1 day |
| 8 | Reminders: scheduler, in-app notifications, email channel | 1 day |
| 9 | Search: query parser (deterministic patterns + LLM fallback → Zod filter) + FTS + aggregates | 1 day |
| 10 | Landing page + privacy/security pages | 1 day |
| 11 | Deletion flows, security suite, Playwright e2e of the full loop, polish | 1–1.5 days |

That's about 2.5–3 weeks of focused build. The first end-to-end "upload → action on dashboard" loop is demoable after step 6.

---

## 10. Biggest risks

1. **Wrong deadlines destroy trust instantly.** One hallucinated "return by Friday" that turns out to be wrong, and the user never trusts the app again.
   - Mitigations: fact/rule separation, evidence grounding, certainty labels, one-tap correction, and a zero-tolerance eval metric.
2. **Receipts usually don't state the return policy.** The headline example ("12 days remaining") mostly depends on outside knowledge.
   - Merchant policies vary by category, membership tier, and holiday season.
   - The curated policy table + "estimated, verify" labeling is the honest answer. Maintaining that table is real product work.
3. **Cold start / manual upload is weak.** Users won't upload 30 receipts by hand. Email is where the value is, but Gmail's read scopes are *restricted*: they require Google verification plus an annual third-party security assessment (CASA), which takes weeks and money.
   - Mitigation: a forwarding address in Phase 1.5, and start Google verification paperwork early.
4. **The first-upload moment has to be fast.** Target under 10s for a text PDF, under 20s for a photo. Vision calls are slower and costlier.
   - Mitigations: local text extraction, a fast classifier, streamed progress, and instant pre-computed sample documents.
5. **Retention.** It's a "set and forget" product, and reminders are the only pull-back mechanism. Email reminders have to work well on day one, not be an afterthought.
6. **Duplicate and conflicting information** across documents about the same purchase. The MVP handles exact duplicates and suggests likely matches. Full resolution comes later.
7. **Photo quality.** Crumpled thermal receipts will extract poorly. We'll mark them `needs_review` rather than guess, and design a good "we need your help" UI state.
8. **Liability perception.** "The app said I had until Friday." Copy should say "estimated" wherever it's true, and terms should be clear.

---

## 11. Making the first 5 minutes feel magical

- **0:00 Landing.** The hero says it in one line. Below it, a looping (real, not illustrative) animation shows a crumpled receipt turning into a "$1,299 · Return by Oct 1 · 6 days left" card. That's the whole product in 4 seconds.
- **0:20 Sign up.** One tap with Google, and no onboarding questionnaire. We quietly infer the timezone.
- **0:30 "Let's find what you're forgetting."**
  - One large drop zone (a camera button on mobile).
  - Prompt chips suggest what to upload: *your last online order · a free-trial email · an airline credit · a warranty card*. These teach the user what the product is for.
  - Beside it: **"No file handy? Try a sample →"** with three realistic sample documents. They run through the same UI with pre-computed results, so they're instant, and the user can judge the product before trusting it with real data.
- **0:45 Processing is visible and real.** Staged progress is driven by actual pipeline events, not a fake spinner:
  - "Reading your receipt…"
  - "Found a Best Buy purchase"
  - "Checking return policy…"
  - "Looking for warranty terms…"
- **~0:55 The reveal.** "**We found 3 things worth knowing.**" The cards settle in one by one:
  - The top card leads with money and time: *"$1,299 · Return window closes in 12 days"*
  - Next, *"2-year warranty · through Sept 2028"*
  - Then *"Saved: Best Buy receipt"*
  - A quiet total underneath: *"$1,299 in deadlines now tracked."*
- **Honesty as a feature.** When something is uncertain, we say so in a way that builds trust: *"This receipt doesn't list a return policy. Best Buy usually allows 15 days, so we've estimated Sept 25. [Looks right] [Edit]"*. Users trust an app more when they catch it being careful.
- **One-tap remind.** Every action has a prefilled smart default ("Remind me 3 days before") so the first reminder takes one tap. We only ask for email notification permission *after* that first reminder, when the reason is obvious.
- **Then invite a second upload.** "Got more? Drop in a subscription email." The dashboard fills in, and the Needs Attention section becomes the reason to come back.
