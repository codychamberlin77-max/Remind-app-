# Email forwarding and past-email import

LIFEOS never logs into anyone's inbox. There are two ways email gets in:

1. **Forwarding (new mail).** Each user gets a private address such as `k7m2p9x4q8rt@in.yourdomain.com`. It works with any provider. They forward emails by hand, or set a Gmail filter, Outlook rule or iCloud rule that forwards only receipts, orders, trials, renewals, credits and warranties. The `/email` page walks them through it. It also shows Gmail's forwarding confirmation code as soon as it arrives, so they never need access to the LIFEOS mailbox.
2. **Past-email import.** The user exports their mail and uploads the file on `/email`. The page has step-by-step instructions for each app:

   | Mail app | Export | File uploaded |
   | --- | --- | --- |
   | Gmail | Google Takeout → Mail | `.zip` (or `.mbox`) |
   | Outlook.com / Hotmail | Settings → Privacy and data → Export mailbox | `.pst` |
   | Outlook for Windows (classic) | File → Open & Export → Export to a file | `.pst` / `.ost` |
   | Outlook for Mac | File → Export | `.olm` |
   | Apple Mail | Mailbox → Export Mailbox, then Compress | `.zip` |
   | Thunderbird | Mail file from the profile folder (no extension), or a zip of several | `INBOX` / `.zip` |

   The file type is detected from its content (zip, PST, or mbox), not its name. The worker scans it once with a local relevance filter, with no AI and no network. It sends only likely receipts, orders, trials, bills, credits and warranties through the normal pipeline. The archive is deleted as soon as the scan ends.

Direct Gmail/Outlook connections (OAuth) are deliberately left for later. Gmail's read scopes are "restricted" and need Google verification plus a yearly CASA security assessment.

## How mail flows

```
sender ─▶ Cloudflare Email Routing (catch-all on in.yourdomain.com)
        ─▶ Email Worker (deploy/cloudflare-email-worker)
        ─▶ POST https://<app>/api/inbound/email   (HMAC-signed, 5-min replay window)
        ─▶ recipient token → user → relevance filter → ingest() → worker pipeline
```

- An unknown or retired address returns 404, and the worker rejects the message.
- A server error returns 5xx. The worker throws, so the sending server retries later.
- The per-address limit is 300 messages a day. Duplicates are ignored by Message-ID.
- Skipped mail (newsletters, social) keeps only a row with the sender domain and score. The content is never stored.

## Setup (about 20 minutes, once)

You need a domain on Cloudflare. A cheap one works; it doesn't need to be your app's domain.

1. **Buy or add a domain in Cloudflare.** Go to dash.cloudflare.com, then **Domain Registration**, then **Register Domains**. You can also add a domain you already own and switch its nameservers to Cloudflare.
2. **Generate the shared secret**, for example with `openssl rand -hex 32`. Keep it out of chat and screenshots.
3. **Deploy the Email Worker.**
   ```sh
   cd deploy/cloudflare-email-worker
   # edit wrangler.toml: LIFEOS_INBOUND_URL = "https://<your app domain>/api/inbound/email"
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put INBOUND_EMAIL_SECRET   # paste the secret from step 2
   ```
   Without the CLI, you can do the same in the dashboard: **Workers & Pages** → **Create** → **Hello World**. Paste `worker.js`, then under **Settings** → **Variables** add `LIFEOS_INBOUND_URL` as a variable and `INBOUND_EMAIL_SECRET` as a secret.
4. **Turn on Email Routing.**
   1. Cloudflare → your domain → **Email** → **Email Routing** → **Get started**. Let it add the MX/TXT records.
   2. Under **Routing rules**, go to **Catch-all address**, choose **Send to a Worker**, and pick the worker from step 3. Enable it.
   3. Optional: use a subdomain such as `in.yourdomain.com`, so your main domain's mail is untouched. Add the subdomain under Email Routing → **Settings** → **Subdomains**.
5. **Configure Railway.** Set these on **both** the web and worker services, then click **Deploy**:
   ```
   INBOUND_EMAIL_DOMAIN=in.yourdomain.com
   INBOUND_EMAIL_SECRET=<same secret as step 2>
   ```
6. **Test it.** Sign in, open **Settings → Email** (`/email`), and send any receipt email to the address shown. It appears under "Recent forwarded email" within seconds, and the extracted item shows on Home.

## Limits and settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_IMPORT_BYTES` | 1 GB | Largest Takeout upload |
| `MAX_IMPORT_DOCUMENTS` | 300 | Maximum emails processed per import (each one is an AI call) |

Plan document limits (`src/server/entitlements.ts`) still apply. An import that hits the limit stops and tells the user.

**Cost note:** each imported email goes through extraction, typically a few cents with Anthropic. The relevance filter usually keeps well under 2% of a mailbox. `MAX_IMPORT_DOCUMENTS` is the hard ceiling.
