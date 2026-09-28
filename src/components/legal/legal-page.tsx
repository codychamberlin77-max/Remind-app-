import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export type LegalSection = { title: string; body: React.ReactNode };

export function LegalPage({ title, intro, updated, sections }: { title: string; intro: React.ReactNode; updated: string; sections: LegalSection[] }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto max-w-3xl px-5 h-[72px] flex items-center justify-between">
        <Logo />
        <nav className="flex gap-5 text-[14px] font-medium text-muted">
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">
        <h1 className="display-2 text-[40px] sm:text-[52px]">{title}</h1>
        <p className="mt-3 text-[13.5px] text-subtle">Last updated {updated}</p>
        <div className="mt-6 text-[16.5px] text-ink-2 leading-relaxed">{intro}</div>
        <nav aria-label="Contents" className="mt-8 rounded-[22px] bg-tile p-5">
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[14px] list-decimal pl-5 marker:text-subtle">
            {sections.map((s, i) => (
              <li key={s.title}><a href={`#s${i + 1}`} className="hover:underline">{s.title}</a></li>
            ))}
          </ol>
        </nav>
        <div className="mt-12 space-y-12">
          {sections.map((s, i) => (
            <section key={s.title} id={`s${i + 1}`} className="scroll-mt-24">
              <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em]">{i + 1}. {s.title}</h2>
              <div className="mt-3 space-y-3 text-[15.5px] text-ink-2 leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_li]:marker:text-subtle [&_a]:underline">{s.body}</div>
            </section>
          ))}
        </div>
        <Link href="/" className="inline-block mt-16 text-[14px] text-muted hover:text-ink">← Back to LIFEOS</Link>
      </main>
    </div>
  );
}

export function Contact({ email }: { email?: string }) {
  return email ? <a href={`mailto:${email}`}>{email}</a> : <span>the contact email listed on our website</span>;
}
