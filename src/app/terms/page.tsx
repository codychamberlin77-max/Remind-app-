import Link from "next/link";
import { Contact, LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { env } from "@/server/env";

export const metadata = { title: "Terms of Service", description: "The terms for using LIFEOS." };
export const dynamic = "force-dynamic";

const UPDATED = "September 28, 2026";

export default function Terms() {
  const e = env();
  const us = e.LEGAL_ENTITY_NAME;
  const contact = <Contact email={e.CONTACT_EMAIL} />;

  const sections: LegalSection[] = [
    {
      title: "Agreeing to these terms",
      body: <p>These terms are an agreement between you and {us} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) for using LIFEOS. By creating an account or using LIFEOS you agree to them. If you don&apos;t agree, please don&apos;t use LIFEOS.</p>,
    },
    {
      title: "What LIFEOS does",
      body: (
        <p>
          LIFEOS reads the receipts, emails and other documents you share, finds return windows, warranties, trials, renewals, credits and other deadlines, and reminds you about them. Some features, like email
          forwarding, connected inboxes and web policy lookups, are optional.
        </p>
      ),
    },
    {
      title: "Estimates, not guarantees",
      body: (
        <>
          <p>
            We label every date and amount as <b>Confirmed</b> (printed on your document), <b>Estimated</b> (worked out from a store or manufacturer policy, or from a hard-to-read document), or <b>Unknown</b>. Estimates can
            be wrong, and store and manufacturer policies change and vary by location, membership and product.
          </p>
          <p>
            <b>LIFEOS is a reminder tool, not financial, legal or consumer advice.</b> Always check important deadlines with the store, manufacturer or provider. We&apos;re not responsible for a missed return,
            warranty claim, cancellation or credit, including if a reminder is late, isn&apos;t delivered, or an extracted detail is wrong.
          </p>
        </>
      ),
    },
    {
      title: "Your account",
      body: (
        <ul>
          <li>You must be at least 13 (or the minimum age where you live) and able to agree to these terms.</li>
          <li>Keep your login details secure; you&apos;re responsible for activity on your account.</li>
          <li>Give us accurate information, and tell us if you think your account has been accessed without permission.</li>
        </ul>
      ),
    },
    {
      title: "Your content",
      body: (
        <>
          <p>
            You own the documents and information you add. You give us permission to store, process and display them only as needed to run LIFEOS for you, as described in our{" "}
            <Link href="/privacy">Privacy Policy</Link>. You confirm you have the right to share the content you add, including emails you forward or connect.
          </p>
        </>
      ),
    },
    {
      title: "Connected accounts",
      body: (
        <p>
          If you connect Gmail or Outlook, you authorize read-only access for the purposes in our Privacy Policy. You can disconnect at any time. Your use of those services remains subject to Google&apos;s and
          Microsoft&apos;s own terms.
        </p>
      ),
    },
    {
      title: "Acceptable use",
      body: (
        <ul>
          <li>Don&apos;t upload content you don&apos;t have the right to share, or anything illegal or harmful.</li>
          <li>Don&apos;t try to access other people&apos;s data, break our security, overload the service, or reverse engineer it.</li>
          <li>Don&apos;t use LIFEOS to send spam or to process other people&apos;s mail without their permission.</li>
        </ul>
      ),
    },
    {
      title: "Price and changes",
      body: (
        <p>
          LIFEOS is free to start. If we introduce paid plans, we&apos;ll tell you the price before you&apos;re charged anything, and free features you already rely on won&apos;t silently become paid. We may change, add or
          remove features; we&apos;ll give reasonable notice of changes that materially affect you.
        </p>
      ),
    },
    {
      title: "Ending your account",
      body: (
        <p>
          You can stop using LIFEOS and delete your account at any time from Settings. We may suspend or close accounts that break these terms or put other users or the service at risk. When an account is deleted,
          we delete its data as described in our Privacy Policy.
        </p>
      ),
    },
    {
      title: "Disclaimers",
      body: (
        <p>
          LIFEOS is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent the law allows, we disclaim all warranties, express or implied, including merchantability, fitness for a particular
          purpose and non-infringement, and we don&apos;t promise that LIFEOS will be uninterrupted, error-free, or that every deadline will be found or be correct.
        </p>
      ),
    },
    {
      title: "Limitation of liability",
      body: (
        <p>
          To the fullest extent the law allows, {us} won&apos;t be liable for any indirect, incidental, special, consequential or punitive damages, or for lost money, refunds, credits or opportunities, arising from your
          use of LIFEOS. Our total liability for any claim is limited to the greater of the amount you paid us in the 12 months before the claim, or US$50. Some places don&apos;t allow these limits, so they may not all
          apply to you.
        </p>
      ),
    },
    {
      title: "Changes to these terms",
      body: <p>We may update these terms. If a change is material, we&apos;ll update the date above and notify you in the app or by email before it takes effect. Continuing to use LIFEOS after that means you accept the new terms.</p>,
    },
    {
      title: "Contact",
      body: <p>{us} · {contact}</p>,
    },
  ];

  return (
    <LegalPage
      title="Terms of Service"
      updated={UPDATED}
      intro={<p>The short version: use LIFEOS to keep track of your own stuff, keep your account safe, and double-check important deadlines. Our estimates are labeled for a reason.</p>}
      sections={sections}
    />
  );
}
