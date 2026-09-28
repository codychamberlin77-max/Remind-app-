import { Contact, LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { env } from "@/server/env";

export const metadata = { title: "Privacy Policy", description: "How LIFEOS collects, uses, protects and deletes your information." };
export const dynamic = "force-dynamic";

const UPDATED = "September 28, 2026";

export default function Privacy() {
  const e = env();
  const us = e.LEGAL_ENTITY_NAME;
  const contact = <Contact email={e.CONTACT_EMAIL} />;

  const sections: LegalSection[] = [
    {
      title: "Who we are",
      body: (
        <p>
          LIFEOS is operated by {us} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). LIFEOS reads receipts, order emails and similar documents you choose to share, finds return windows, warranties, trials, credits and other
          deadlines in them, and reminds you before they pass. Questions about this policy: {contact}.
        </p>
      ),
    },
    {
      title: "What we collect",
      body: (
        <>
          <ul>
            <li><b>Account details:</b> your name, email address, timezone, reminder preferences, and a hashed password (or your Google account ID if you sign in with Google).</li>
            <li><b>Things you give us:</b> files you upload (receipts, PDFs, screenshots, photos), emails you forward to your LIFEOS address, mailbox exports you import, and purchases you type in by hand.</li>
            <li><b>Connected inboxes (only if you connect one):</b> see section 4. We read only emails that look like receipts, orders, trials, bills, credits or warranties.</li>
            <li><b>What we extract:</b> merchants, amounts, dates, return windows, warranties, deadlines and the reminders built from them.</li>
            <li><b>Security and service logs:</b> records of important events (for example &ldquo;a document was deleted&rdquo;) and a one-way hash of your IP address for abuse prevention. These never contain document content.</li>
          </ul>
          <p>We use only the cookies needed to keep you signed in and to complete a secure inbox connection. We don&apos;t use advertising or cross-site tracking cookies.</p>
        </>
      ),
    },
    {
      title: "How we use it",
      body: (
        <>
          <ul>
            <li>To provide LIFEOS: read your documents, find deadlines, show them to you, and send the reminders you&apos;ve chosen (in the app and by email).</li>
            <li>To keep the service secure, prevent abuse, and fix problems.</li>
            <li>To contact you about your account or important changes.</li>
          </ul>
          <p><b>We don&apos;t sell your personal information, we don&apos;t show ads, and we don&apos;t use your documents or emails to train AI models.</b></p>
        </>
      ),
    },
    {
      title: "Connected Gmail and Outlook accounts",
      body: (
        <>
          <p>If you choose &ldquo;Connect Gmail&rdquo; or &ldquo;Connect Outlook&rdquo;, you give LIFEOS read-only access to your mailbox (Google scope <code>gmail.readonly</code>; Microsoft permission <code>Mail.Read</code>). We use that access only to:</p>
          <ul>
            <li>look for new emails whose subject or sender suggests a receipt, order, trial, subscription, bill, credit or warranty;</li>
            <li>download those emails and extract the purchase and deadline details shown to you in LIFEOS.</li>
          </ul>
          <p>
            Emails that don&apos;t look relevant are never downloaded; for skipped emails we keep only a message ID, the sender&apos;s domain and a relevance score so we don&apos;t check them twice. We never send, delete,
            label or change your email. Access tokens are encrypted at rest. You can disconnect at any time from the Email page; disconnecting (or deleting your account) revokes our access where the provider allows it
            and deletes our tokens. Documents already added stay until you delete them.
          </p>
          <p>
            <b>Google user data.</b> LIFEOS&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Specifically, we use
            Gmail data only to provide the features described above; we don&apos;t use it for advertising, we don&apos;t sell it, we don&apos;t use it to train AI or machine-learning models, and no person at {us} reads it
            except with your explicit permission (for example, to help you with a support request), when needed for security, or when required by law.
          </p>
        </>
      ),
    },
    {
      title: "AI processing and policy lookups",
      body: (
        <ul>
          <li>To understand a document, we send its content to our AI provider (Anthropic). Before we do, we remove full card numbers, Social Security numbers, and your own name and email address.</li>
          <li>Our AI provider processes this data under API terms that don&apos;t allow it to be used to train their models.</li>
          <li>
            When a receipt doesn&apos;t say how long you have to return something, we may look up the store&apos;s or manufacturer&apos;s public policy on the web. Those lookups contain only the store or brand and the type
            of product, never anything about you. The results are shared across users because they contain no personal information.
          </li>
          <li>Sample documents on the welcome screen are processed without any external AI call.</li>
        </ul>
      ),
    },
    {
      title: "Who we share it with",
      body: (
        <>
          <p>We share information only with service providers that help us run LIFEOS, and only as needed for that purpose:</p>
          <ul>
            <li><b>Railway</b>: hosting and database.</li>
            <li><b>Cloudflare</b>: private file storage and, if enabled, receiving forwarded email.</li>
            <li><b>Anthropic</b>: AI processing of document content (see section 5).</li>
            <li><b>Resend</b>: delivering reminder emails.</li>
            <li><b>Google and Microsoft</b>: only if you connect your Gmail or Outlook account, or sign in with Google.</li>
          </ul>
          <p>We may also disclose information if required by law, to protect the rights and safety of our users or the public, or as part of a merger or acquisition (in which case this policy continues to apply).</p>
        </>
      ),
    },
    {
      title: "How we protect it",
      body: (
        <ul>
          <li>All connections use TLS. Stored data is encrypted at rest by our providers; credit/confirmation codes and inbox access tokens get an additional layer of encryption from us.</li>
          <li>Files are kept in private storage with no public links and are served only to your signed-in account after an ownership check.</li>
          <li>Every database query is limited to your account in our code and enforced again by row-level security in the database.</li>
          <li>Photos are re-encoded on upload, which removes location and device metadata. File types that can run code in a browser are rejected.</li>
          <li>We don&apos;t offer end-to-end encryption: our systems need to read your documents to find deadlines in them.</li>
        </ul>
      ),
    },
    {
      title: "How long we keep it, and deleting it",
      body: (
        <ul>
          <li>We keep your information while your account is active.</li>
          <li>You can delete any document, any item, all of your data, or your whole account from Settings. Deleting removes the files and everything extracted from them.</li>
          <li>Uploaded mailbox exports are deleted as soon as they&apos;ve been scanned.</li>
          <li>After deletion, copies in our providers&apos; backups expire on their normal schedule.</li>
        </ul>
      ),
    },
    {
      title: "Your choices and rights",
      body: (
        <>
          <p>
            You can see and correct your information in the app, change reminder settings, disconnect inboxes, export what&apos;s shown on screen, and delete your data at any time. Depending on where you live (for example,
            California, the EU or the UK), you may also have rights to access, correct, delete, or port your personal information, and to object to or restrict certain processing. To make a request, contact {contact}. We
            won&apos;t discriminate against you for using these rights.
          </p>
        </>
      ),
    },
    {
      title: "Children",
      body: <p>LIFEOS isn&apos;t intended for children under 13 (or the minimum age in your country), and we don&apos;t knowingly collect their information. If you believe a child has given us information, contact us and we&apos;ll delete it.</p>,
    },
    {
      title: "Changes to this policy",
      body: <p>If we make material changes, we&apos;ll update the date above and let you know in the app or by email before they take effect.</p>,
    },
    {
      title: "Contact",
      body: <p>{us} · {contact}</p>,
    },
  ];

  return (
    <LegalPage
      title="Privacy Policy"
      updated={UPDATED}
      intro={<p>The short version: we read what you share with us so we can find your deadlines. We don&apos;t sell it, we don&apos;t advertise with it, we don&apos;t train AI on it, and you can delete it any time.</p>}
      sections={sections}
    />
  );
}
