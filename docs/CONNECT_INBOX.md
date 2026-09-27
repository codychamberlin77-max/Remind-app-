# Connect Gmail / Outlook

Users sign in once, and LIFEOS reads their receipt, order, trial and bill emails automatically, with no forwarding address.

- **Read-only.** Gmail uses `gmail.readonly`, and Outlook uses `Mail.Read`. We never send, delete or change mail.
- **Only likely receipts are opened.** Messages are listed with a subject search first. The local relevance filter then decides from the subject and sender, and only likely receipts are downloaded.
- **Tokens are encrypted at rest** (`FIELD_ENCRYPTION_KEY`). Disconnecting, or deleting the account, revokes Google's access and deletes our copy. Anything already imported stays.
- **Syncing.** The worker syncs every connection every 15 minutes (`sync-mailboxes`). The first sync looks back `MAIL_SYNC_BACKFILL_DAYS` (default 90) in slices of up to 40 imports.

Redirect URIs (replace the domain if you add a custom one):

```
https://remind-app-production.up.railway.app/api/connections/gmail/callback
https://remind-app-production.up.railway.app/api/connections/outlook/callback
```

## Gmail (Google Cloud)

1. Go to https://console.cloud.google.com. Create a project, or use the one you use for "Sign in with Google".
2. Under **APIs & Services → Library**, enable the **Gmail API**.
3. Under **Google Auth Platform** (OAuth consent screen), choose **External**, and fill in the app name, support email and developer email.
4. Under **Audience**, leave the app in **Testing** and add each beta user's Gmail address as a test user (up to 100).
5. Under **Data access**, add the scope `https://www.googleapis.com/auth/gmail.readonly`.
6. Under **Clients → Create client**, choose **Web application**, and add the Gmail redirect URI above.
7. In Railway, on **both** the web and worker services, set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`, then click **Deploy**.

**Testing mode:**
- Only listed test users can connect, and Google shows an "unverified app" screen they click through.
- Access for apps in testing expires after about 7 days. The app then shows "Reconnect".

**Going public:**
- Publish the app and submit it for Google verification. Gmail read access is a restricted scope, so this requires:
  - a privacy policy and homepage on your own domain
  - a demo video
  - a yearly third-party security assessment (CASA)
- Start early. It takes weeks.

## Outlook / Hotmail / Microsoft 365 (Microsoft Entra)

1. Go to https://entra.microsoft.com, then **App registrations → New registration**.
2. Under **Supported account types**, choose **Accounts in any organizational directory and personal Microsoft accounts**.
3. Under **Redirect URI**, choose **Web** and enter the Outlook redirect URI above.
4. Under **Certificates & secrets → New client secret**, copy the **Value**. It's shown only once.
5. Under **API permissions → Microsoft Graph → Delegated**, add `Mail.Read`, `User.Read`, `offline_access`, `openid` and `email`.
6. In Railway, on **both** services, set:
   - `MICROSOFT_CLIENT_ID` (the Application/client ID)
   - `MICROSOFT_CLIENT_SECRET`

   Then click **Deploy**.

Personal Outlook.com and Hotmail accounts work right away. Many work and school accounts block unverified apps. Completing **publisher verification** (it needs a Microsoft Partner Network ID) removes that block.

The Connect buttons appear on `/email` automatically once a provider's keys are set.
