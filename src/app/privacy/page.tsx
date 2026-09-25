import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export const metadata = { title: "Privacy & security" };

const sections: Array<[string, string[]]> = [
  ["What we store", [
    "The files you upload, the text we read from them, and the facts we extract (amounts, dates, merchants).",
    "Your account details: name, email, timezone, and a hashed password if you don't use Google sign-in.",
    "A security log of important events (for example, “a document was deleted”). It never contains document content.",
  ]],
  ["How files are protected", [
    "Files are kept in private object storage with no public access. They are served only to your signed-in account, after an ownership check on every request.",
    "Photos are re-encoded when you upload them, which removes location and device metadata.",
    "Uploads are checked by their contents, not their names. Types that can run code in a browser (such as HTML and SVG) are rejected.",
  ]],
  ["Encryption", [
    "All connections use TLS.",
    "Stored data is encrypted at rest by our infrastructure providers.",
    "Credit and confirmation codes are additionally encrypted by our application before they are stored.",
    "We do not offer end-to-end encryption: our servers can read your documents in order to find deadlines in them.",
  ]],
  ["AI processing", [
    "To understand a document, we send its content to an AI provider. Before we do, we remove full card numbers, Social Security numbers, and your own name and email address.",
    "We don't use your documents to train models, and we use AI providers under API terms that don't use them for training.",
    "The sample documents on the welcome screen are processed without any external AI call.",
  ]],
  ["Isolation between accounts", [
    "Every query for your data is scoped to your account in our application code, and enforced again by row-level security in the database itself.",
  ]],
  ["Deletion", [
    "You can delete any document, any item, all of your data, or your whole account from Settings.",
    "Deleting a document removes the file and everything extracted from it. Deleting your account removes all of your files and data; our database provider's backups expire on their normal schedule.",
  ]],
];

export default function Privacy() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto max-w-3xl px-5 h-16 flex items-center"><Logo /></header>
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">
        <h1 className="text-[36px] font-semibold tracking-[-0.03em]">Privacy &amp; security</h1>
        <p className="mt-3 text-muted text-[16px]">Plain answers to “what happens to my documents?”</p>
        <div className="mt-12 space-y-10">
          {sections.map(([title, items]) => (
            <section key={title}>
              <h2 className="text-[17px] font-semibold">{title}</h2>
              <ul className="mt-3 space-y-2.5 text-[15px] text-ink-2 leading-relaxed list-disc pl-5 marker:text-subtle">
                {items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <Link href="/" className="inline-block mt-14 text-[14px] text-muted hover:text-ink">← Back</Link>
      </main>
    </div>
  );
}
