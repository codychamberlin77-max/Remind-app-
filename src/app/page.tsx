import { ArrowRight, Check, FileText, Lock, Plane, ReceiptText, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CertaintyBadge } from "@/components/ui/certainty";
import { Logo } from "@/components/ui/logo";

export default function Landing() {
  return (
    <div className="bg-canvas">
      <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-md border-b border-transparent">
        <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-14 sm:pt-24 pb-16 grid lg:grid-cols-[1.1fr_1fr] gap-14 items-center">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[44px] sm:text-[64px] leading-[1.02] tracking-[-0.035em] font-semibold">
            Your life has too&nbsp;much admin.
          </h1>
          <p className="mt-6 text-[18px] sm:text-[19px] leading-relaxed text-muted max-w-[34rem]">
            Upload your receipts, documents, screenshots, and confirmations. We&apos;ll find the deadlines, warranties,
            subscriptions, credits, and tasks hiding inside them.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Find What I&apos;m Forgetting <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href="#how">See how it works</a>
            </Button>
          </div>
          <p className="mt-5 text-[13px] text-subtle">Free to start. No bank connection. No inbox access required.</p>
        </div>
        <HeroVisual />
      </section>

      {/* How */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-20 border-t border-line">
        <p className="text-[13px] font-medium text-muted mb-3">How it works</p>
        <h2 className="text-[30px] sm:text-[38px] tracking-[-0.025em] font-semibold max-w-2xl leading-tight">
          Give us the messy stuff. We&apos;ll find what needs your attention.
        </h2>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {[
            ["Upload anything", "Receipts, order emails, PDFs, screenshots, photos of paper. Drag them in or snap a picture."],
            ["We read it carefully", "Dates, amounts, return windows, warranties, renewals — every fact checked against the document itself."],
            ["You get reminded", "What matters shows up first, with a reminder before it's too late. One tap to mark it done."],
          ].map(([t, d], i) => (
            <div key={t} className="p-6 rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
              <span className="text-[12px] tabular text-subtle">0{i + 1}</span>
              <h3 className="mt-3 font-semibold text-[16px]">{t}</h3>
              <p className="mt-2 text-[14.5px] text-muted leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-6xl px-5 py-20 grid md:grid-cols-2 gap-5">
        <Value
          icon={<ReceiptText className="size-5" />}
          title="Never miss a return."
          body="We work out every return window — from your receipt when it says, from the store's typical policy when it doesn't — and tell you which one it is."
          card={<MiniCard title="Samsung 65″ TV" value="$1,299.99" line="Return window · Estimated: 12 days remaining" certainty="estimated" />}
        />
        <Value
          icon={<ShieldCheck className="size-5" />}
          title="Never forget a warranty."
          body="Protection plans and warranties are tracked from the day you buy, so a repair is covered while it still can be."
          card={<MiniCard title="MacBook Pro · AppleCare+" value="Until Nov 1, 2028" line="Printed on your coverage document" certainty="confirmed" />}
        />
        <Value
          icon={<Plane className="size-5" />}
          title="Never lose a travel credit."
          body="Airline credits quietly expire. We keep the amount, the expiry, and whether it's book-by or travel-by."
          card={<MiniCard title="Delta eCredit" value="$431.00" line="Book by Mar 12, 2027" certainty="confirmed" />}
        />
        <Value
          icon={<FileText className="size-5" />}
          title="Never overlook a deadline."
          body="Free trials, renewals, bills, and appointments surface before they cost you — ranked by what's at stake, not just the date."
          card={<MiniCard title="Free trial ends" value="$19.99/mo" line="Converts to paid on Sunday" certainty="confirmed" />}
        />
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-5 py-20 border-t border-line grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="text-[30px] sm:text-[38px] tracking-[-0.025em] font-semibold leading-tight">We tell you when we&apos;re not sure.</h2>
          <p className="mt-5 text-[16px] text-muted leading-relaxed max-w-xl">
            A wrong deadline is worse than no deadline. Every date and amount we show is labeled — and if your document doesn&apos;t
            say, we won&apos;t pretend it does.
          </p>
        </div>
        <div className="space-y-3">
          {[
            ["confirmed", "Printed on your document, and we checked it's really there."],
            ["estimated", "Worked out from a typical policy or a hard-to-read document. We show you why."],
            ["unknown", "Not on the document. You can add it in one tap."],
          ].map(([c, d]) => (
            <div key={c} className="flex items-start gap-4 p-4 rounded-2xl bg-surface shadow-[var(--shadow-card)]">
              <CertaintyBadge certainty={c as "confirmed"} className="mt-0.5 shrink-0" />
              <p className="text-[14.5px] text-ink-2">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section id="privacy" className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Lock className="size-6 text-white/60" />
          <h2 className="mt-5 text-[30px] sm:text-[38px] tracking-[-0.025em] font-semibold">Your information is yours.</h2>
          <p className="mt-4 text-white/70 max-w-2xl text-[16px] leading-relaxed">
            The documents you give us are personal. Here is exactly how we handle them.
          </p>
          <ul className="mt-10 grid md:grid-cols-2 gap-x-10 gap-y-6">
            {[
              ["Private by default", "Your files are kept in private storage and are only served to your signed-in account. There are no public links to your documents."],
              ["Encrypted in transit and at rest", "Connections use TLS. Stored data is encrypted at rest by our infrastructure providers, and credit and confirmation codes get an extra layer of encryption from us."],
              ["Less data sent to AI", "Before a document is analyzed, we remove full card numbers and your own name and email. Photos are stripped of location and device metadata when you upload them."],
              ["Not used for training", "We don't use your documents to train models, and we use AI providers under API terms that don't use them for training either."],
              ["Delete anytime", "Delete a single document, an item, or your whole account. Deleting removes the files and everything we extracted from them."],
              ["No bank or inbox access required", "You choose exactly what we see. Email connections will always be optional and scoped."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <Check className="size-4 mt-1 text-white/50 shrink-0" />
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="text-white/65 text-[14.5px] mt-1 leading-relaxed">{d}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/privacy" className="inline-flex items-center gap-1.5 mt-10 text-[14px] text-white/80 hover:text-white">
            Read the details <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-24 text-center">
        <h2 className="text-[34px] sm:text-[44px] tracking-[-0.03em] font-semibold">What are you forgetting?</h2>
        <p className="mt-4 text-muted text-[17px]">Upload one receipt. See what we find.</p>
        <Button asChild size="lg" className="mt-8">
          <Link href="/sign-up">
            Find What I&apos;m Forgetting <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between text-[13px] text-subtle">
          <span>LIFEOS (working name)</span>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <span className="inline-flex items-center gap-1"><Trash2 className="size-3" /> Delete anytime</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Value({ icon, title, body, card }: { icon: React.ReactNode; title: string; body: string; card: React.ReactNode }) {
  return (
    <div className="p-7 rounded-[20px] bg-surface shadow-[var(--shadow-card)] flex flex-col">
      <span className="grid place-items-center size-9 rounded-xl bg-canvas text-ink-2">{icon}</span>
      <h3 className="mt-5 text-[20px] font-semibold tracking-[-0.015em]">{title}</h3>
      <p className="mt-2 text-[15px] text-muted leading-relaxed">{body}</p>
      <div className="mt-6 pt-6 border-t border-line">{card}</div>
    </div>
  );
}

function MiniCard({ title, value, line, certainty }: { title: string; value: string; line: string; certainty: "confirmed" | "estimated" }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[14px] font-medium truncate">{title}</p>
        <p className="text-[13px] text-muted mt-0.5 truncate">{line}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[14px] font-semibold tabular">{value}</p>
        <CertaintyBadge certainty={certainty} className="mt-1" />
      </div>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[440px]" aria-hidden>
      <div className="absolute -left-2 top-6 w-[210px] rotate-[-5deg] rounded-md bg-white p-4 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)] font-[family-name:var(--font-mono)] text-[9.5px] leading-[1.55] text-ink-2">
        <p className="font-bold">BEST BUY</p>
        <p className="text-subtle">Store #1047</p>
        <p className="mt-2">Date: Sep 22, 2026</p>
        <p className="mt-2">SAMSUNG 65&quot; QLED TV&nbsp;&nbsp;1,299.99</p>
        <p>GEEK SQUAD 2-YR PLAN&nbsp;&nbsp;&nbsp;179.99</p>
        <p className="mt-2">TAX&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;131.35</p>
        <p className="font-bold">TOTAL&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;$1,611.33</p>
        <p className="mt-2 text-subtle">VISA ****4821</p>
      </div>
      <div className="relative ml-auto w-[300px] mt-24 sm:mt-16 rounded-[20px] bg-surface p-5 shadow-[var(--shadow-pop)]">
        <p className="text-[12px] font-medium text-muted">We found 4 things worth knowing</p>
        <div className="mt-4 space-y-3.5">
          <Row label="Purchase" value="$1,611.33" sub="Samsung 65″ TV · Best Buy" certainty="confirmed" />
          <Row label="Return window" value="12 days" sub="Estimated from Best Buy's typical policy" certainty="estimated" />
          <Row label="Warranty" value="2 years" sub="Geek Squad plan on your receipt" certainty="confirmed" />
          <div className="pt-3.5 border-t border-line flex items-center justify-between">
            <span className="text-[13px] text-muted">Money protected</span>
            <span className="text-[15px] font-semibold text-money tabular">$1,611.33</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, sub, certainty }: { label: string; value: string; sub: string; certainty: "confirmed" | "estimated" }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] text-muted">{label}</p>
        <p className="text-[12px] text-subtle truncate">{sub}</p>
      </div>
      <div className="text-right">
        <p className="text-[14px] font-semibold tabular">{value}</p>
        <CertaintyBadge certainty={certainty} className="mt-1" />
      </div>
    </div>
  );
}
