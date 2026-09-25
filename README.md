# LIFEOS (working name)

> Your life has too much admin. Give us the messy stuff. We'll find what needs your attention.

Upload receipts, screenshots, PDFs, and emails. LIFEOS finds the return windows, warranties, trials, renewals, credits, and bills inside them. It labels every fact **Confirmed**, **Estimated**, or **Unknown**, ranks what matters, and reminds you before it's too late.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture and the reasoning behind it.

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL + Drizzle (with row-level security) · Better Auth · pg-boss worker · Cloudflare R2 · Anthropic (behind a provider interface, with a deterministic mock) · Tailwind + Radix · Zod · Vitest · Playwright.

## Local development

Requirements: Node 22.12+ and PostgreSQL 16. `docker compose up -d` is the easiest way to get Postgres.

```bash
npm ci
cp .env.example .env            # defaults work for local dev (mock AI, local file storage)
createdb lifeos_dev && createdb lifeos_test
npm run db:migrate              # as the owner role; creates the RLS-restricted `lifeos_app` role
npm run dev                     # web on :3000
npm run worker                  # background worker (or set JOBS_MODE=inline to skip it)
```

With `AI_PROVIDER=mock`, the three built-in samples and every file in `tests/evals/fixtures/` are "read" through recorded model responses, so the whole product works without an API key. To use Claude, set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.

## Tests

```bash
npm test                        # unit + integration + security + extraction eval (mock), against lifeos_test
npm run build && npm run test:e2e   # Playwright: full upload → reminder → correct → delete loop, desktop + mobile
npm run eval                    # extraction eval report (mock)
npm run eval -- --provider anthropic    # same 16 documents against the live model
npm run fixtures:build          # re-render the evaluation documents
```

The eval reports extraction accuracy, the **false deadline rate** (the target is zero), deadline recall, the evidence validation rate, confidence calibration (ECE), and processing time.

## Deploying on Railway

1. Create a Postgres service. Set `DATABASE_ADMIN_URL` to its URL (the owner role). Set `APP_DB_PASSWORD`. Set `DATABASE_URL` to `postgres://lifeos_app:<APP_DB_PASSWORD>@<host>:<port>/<db>`. The app itself never connects as the owner.
2. **Web service**: config file `deploy/railway.web.json`. It runs migrations before each deploy.
3. **Worker service**: same repo, config file `deploy/railway.worker.json`.
4. Create a private R2 bucket (no public access) and set `STORAGE_DRIVER=r2` and the `R2_*` variables.
5. Set `BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEY` (`openssl rand -base64 32`), `APP_URL`, and optionally `GOOGLE_CLIENT_ID/SECRET`, `EMAIL_DRIVER=resend` + `RESEND_API_KEY` + `EMAIL_FROM`.
6. Set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` when you're ready for real documents.
