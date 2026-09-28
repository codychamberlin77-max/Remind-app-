import { ArrowRight, ArrowUpRight, Check, Lock, Mail, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { CheckBubble, Coin, CreditBuddy, Dot, Heart, KIND_STYLE, ReceiptBuddy, ShieldBuddy, Sparkle, Star, TrialBuddy } from "@/components/brand/stickers";
import { Button } from "@/components/ui/button";
import { CertaintyBadge } from "@/components/ui/certainty";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const FORGOTTEN = [
  "A return window closing Friday",
  "A receipt you lost in March",
  "A free trial that becomes $19.99/mo",
  "$431 of airline credit",
  "A 2-year TV warranty",
  "A gym renewal you meant to cancel",
  "A rebate form due in 9 days",
  "An AppleCare plan until 2028",
  "A price you could still return",
  "A bill due Tuesday",
];

export default function Landing() {
  return (
    <div className="bg-canvas overflow-x-clip">
      <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-5 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Logo />
            <nav className="hidden md:flex items-center gap-6 text-[15px] font-medium text-ink-2">
              <a href="#how" className="hover:text-ink">How it works</a>
              <a href="#reminders" className="hover:text-ink">Reminders</a>
              <a href="#privacy" className="hover:text-ink">Privacy</a>
            </nav>
          </div>
          <nav className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/sign-in">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative">
        <HeroStickersLeft />
        <HeroStickersRight />
        <div className="relative mx-auto max-w-3xl px-5 pt-10 sm:pt-28 pb-20 sm:pb-32 text-center">
          <MobileStickers />
          <h1 className="display text-[58px] sm:text-[96px] text-ink [perspective:600px]" aria-label="Forget things. We won't.">
            <RiseWords lines={["Forget things.", "We won't."]} />
          </h1>
          <p className="mt-7 text-[18px] sm:text-[20px] leading-relaxed text-muted max-w-xl mx-auto animate-rise [animation-delay:80ms]">
            Snap a receipt, forward an email, or just type what you bought. We find every return window, warranty, free trial and credit, then remind you before it costs you.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center animate-rise [animation-delay:160ms]">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Find what I&apos;m forgetting <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="#how">
                <Play className="size-4 fill-current" /> See how it works
              </a>
            </Button>
          </div>
          <p className="mt-6 text-[13.5px] text-subtle">Free to start · No bank login · Delete anytime</p>
        </div>
      </section>

      {/* ── Marquee of forgotten things ── */}
      <section aria-label="Things people forget" className="border-y border-line py-5 overflow-hidden">
        <div className="flex w-max gap-3 animate-marquee motion-reduce:animate-none">
          {[...FORGOTTEN, ...FORGOTTEN].map((t, i) => (
            <span key={i} className="inline-flex items-center gap-2.5 h-11 px-5 rounded-full bg-tile text-[15px] font-medium text-ink-2 whitespace-nowrap">
              <Dot className="size-2.5" color={["var(--color-blue)", "var(--color-grape)", "var(--color-coral)", "var(--color-leaf)"][i % 4]!} />
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ── How it works (bento) ── */}
      <section id="how" className="mx-auto max-w-6xl px-5 pt-24 sm:pt-32">
        <h2 className="display-2 text-[40px] sm:text-[56px] text-center">Give us the mess.</h2>
        <p className="mt-4 text-center text-[18px] text-muted">We&apos;ll deal with the fine print.</p>
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Bento step={1} title="Drop it in" body="Receipts, PDFs, screenshots, photos of paper. Or forward the email and never lift a finger.">
            <div className="flex flex-col gap-2 w-full max-w-[250px]">
              {[
                ["bestbuy-receipt.pdf", "var(--color-blue)"],
                ["Fwd: Your order #112-4471", "var(--color-grape)"],
                ["IMG_4821.jpg", "var(--color-coral)"],
              ].map(([f, c], i) => (
                <div key={f} className="flex items-center gap-3 h-12 px-4 rounded-2xl bg-surface shadow-[var(--shadow-card)] text-[13.5px] font-medium">
                  <Dot className="size-3" color={c!} />
                  <span className="truncate">{f}</span>
                </div>
              ))}
            </div>
          </Bento>
          <Bento step={2} title="We read the fine print" body="Dates, amounts, return windows, warranties. Every one checked against the document itself.">
            <div className="w-full max-w-[250px] rounded-2xl bg-surface shadow-[var(--shadow-card)] p-4 space-y-3">
              <FactRow stacked label="Purchased" value="Sep 22" certainty="confirmed" />
              <FactRow stacked label="Return by" value="Oct 6" certainty="estimated" />
              <FactRow stacked label="Serial no." value="—" certainty="unknown" />
            </div>
          </Bento>
          <Bento step={3} title="We fill the gaps" body="Receipt doesn't say? We look up the store's actual policy and show you exactly where it came from.">
            <div className="w-full max-w-[250px] rounded-2xl bg-surface shadow-[var(--shadow-card)] p-4">
              <p className="text-[12px] font-medium text-muted">Target · return policy</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="font-display text-[22px] font-semibold tracking-[-0.03em]">90 days</span>
                <CertaintyBadge certainty="estimated" />
              </div>
              <p className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-ink">
                From target.com <ArrowUpRight className="size-3.5" />
              </p>
            </div>
          </Bento>
          <Bento step={4} title="You get a heads-up" body="1 week, 3 days and the day of. Handled it? Tap done and we go quiet.">
            <div className="w-full max-w-[250px] rounded-2xl bg-ink text-white p-4 shadow-[var(--shadow-pop)]">
              <div className="flex items-center gap-2 text-[12px] text-white/60">
                <span className="grid place-items-center size-5 rounded-md bg-coral text-[10px] font-bold">!</span> LIFEOS · now
              </div>
              <p className="mt-2 text-[14px] font-semibold">In 3 days: Return window</p>
              <p className="text-[13px] text-white/70">Samsung 65″ TV · $1,299.99</p>
            </div>
          </Bento>
        </div>
      </section>

      {/* ── The four things (colored tiles) ── */}
      <section className="mx-auto max-w-6xl px-5 pt-24 sm:pt-32">
        <p className="text-[15px] font-semibold text-coral-ink">What we catch</p>
        <h2 className="mt-2 display-2 text-[40px] sm:text-[56px] max-w-3xl">
          Money you already spent.
          <br />
          <span className="text-subtle">Kept from slipping away.</span>
        </h2>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KindTile kind="purchase" title="Return windows" value="$1,299.99" line="Samsung 65″ TV · 12 days left" certainty="estimated" />
          <KindTile kind="subscription" title="Free trials" value="$19.99/mo" line="StreamMax · converts Sunday" certainty="confirmed" />
          <KindTile kind="travel_credit" title="Travel credits" value="$431.00" line="Delta eCredit · book by Mar 12" certainty="confirmed" />
          <KindTile kind="warranty" title="Warranties" value="Until 2028" line="MacBook Pro · AppleCare+" certainty="confirmed" />
        </div>
      </section>

      {/* ── Lost receipt ── */}
      <section className="mx-auto max-w-6xl px-5 pt-24 sm:pt-32 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="lg:order-2 relative rounded-[28px] bg-coral brut p-6 sm:p-10 min-h-[360px] grid place-items-center overflow-hidden">
          <Sparkle className="absolute top-8 left-9 w-7" color="#fff" />
          <Coin className="absolute bottom-8 right-8 w-11" />
          <div className="w-full max-w-[330px] space-y-3">
            <div className="rounded-2xl bg-white/95 px-4 py-3.5 shadow-[var(--shadow-pop)]">
              <p className="text-[12px] font-medium text-muted">You type</p>
              <p className="mt-0.5 text-[15px] font-semibold">Samsung 65″ TV · Best Buy · last month</p>
            </div>
            <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-pop)] space-y-3">
              <p className="text-[12px] font-medium text-muted">We find</p>
              <FactRow label="Return window" value="15 days" certainty="estimated" />
              <FactRow label="Warranty" value="1 year" certainty="estimated" />
              <p className="text-[12.5px] text-muted">+ how to get your receipt back</p>
            </div>
          </div>
        </div>
        <div>
          <p className="text-[15px] font-semibold text-coral-ink">Lost the receipt?</p>
          <h2 className="mt-2 display-2 text-[40px] sm:text-[52px]">No receipt. No problem.</h2>
          <p className="mt-5 text-[18px] text-muted leading-relaxed">
            Just tell us what you bought and where. We pull the store&apos;s return policy and the manufacturer&apos;s warranty straight from their websites, and show you how to get a copy of the receipt.
          </p>
        </div>
      </section>

      {/* ── Honest by design ── */}
      <section id="honest" className="mx-auto max-w-6xl px-5 pt-24 sm:pt-32 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="relative rounded-[28px] bg-tile p-6 sm:p-10 min-h-[380px] grid place-items-center overflow-hidden">
          <Coin className="absolute top-8 left-8 w-10" />
          <Sparkle className="absolute bottom-10 right-10 w-7" color="var(--color-grape)" />
          <div className="relative w-full max-w-[330px] rounded-[22px] bg-surface p-5 shadow-[var(--shadow-pop)]">
            <p className="text-[13px] font-medium text-muted">We found 4 things worth knowing</p>
            <div className="mt-4 space-y-3.5">
              <FactRow label="Purchase · $1,611.33" value="Sep 22" certainty="confirmed" />
              <FactRow label="Return window" value="12 days" certainty="estimated" />
              <FactRow label="Geek Squad plan" value="2 years" certainty="confirmed" />
              <div className="pt-3.5 border-t border-line flex items-center justify-between">
                <span className="text-[13.5px] text-muted">Money protected</span>
                <span className="font-display text-[20px] font-semibold text-leaf-ink tabular">$1,611.33</span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <p className="text-[15px] font-semibold text-blue-ink">Honest by design</p>
          <h2 className="mt-2 display-2 text-[40px] sm:text-[52px]">We tell you when we&apos;re not sure.</h2>
          <p className="mt-5 text-[18px] text-muted leading-relaxed">
            A wrong deadline is worse than none. Every date and amount gets a label, and when we&apos;re estimating, we tell you why and show the source.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              ["confirmed", "Printed on your document, and we checked it's really there."],
              ["estimated", "Worked out from the store's own policy page or a hard-to-read photo. Tap to see the source."],
              ["unknown", "Nobody says. Add it in one tap and we'll do the math."],
            ].map(([c, d]) => (
              <li key={c} className="flex items-start gap-4">
                <CertaintyBadge certainty={c as "confirmed"} className="mt-0.5 shrink-0" />
                <p className="text-[15.5px] text-ink-2">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Email ── */}
      <section className="mx-auto max-w-6xl px-5 pt-24 sm:pt-32 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="lg:order-2 relative rounded-[28px] bg-grape brut p-6 sm:p-10 min-h-[340px] grid place-items-center overflow-hidden">
          <Star className="absolute top-8 right-10 w-9" />
          <Heart className="absolute bottom-8 left-8 w-10" />
          <div className="w-full max-w-[330px] space-y-2.5">
            {[
              ["Your Amazon.com order has shipped", "Added"],
              ["Your free trial ends Friday", "Added"],
              ["48-hour flash sale: 40% off!", "Ignored"],
            ].map(([s, st]) => (
              <div key={s} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 h-14 shadow-[var(--shadow-pop)]">
                <span className="flex items-center gap-3 min-w-0 text-[13.5px] font-medium">
                  <Mail className="size-4 text-muted shrink-0" />
                  <span className="truncate">{s}</span>
                </span>
                <span className={cn("text-[12px] font-semibold shrink-0", st === "Added" ? "text-leaf-ink" : "text-subtle")}>{st}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[15px] font-semibold text-grape-ink">Works with your inbox</p>
          <h2 className="mt-2 display-2 text-[40px] sm:text-[52px]">Forward it. Forget it.</h2>
          <p className="mt-5 text-[18px] text-muted leading-relaxed">
            Get your own private LIFEOS address. Set one filter and receipts, trials and order emails roll in on their own. Newsletters get ignored. Sitting on years of old email? Import it from Gmail, Outlook, Apple Mail or Thunderbird in one go.
          </p>
        </div>
      </section>

      {/* ── Reminders ── */}
      <section id="reminders" className="mx-auto max-w-6xl px-5 pt-24 sm:pt-32 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="relative rounded-[28px] bg-leaf brut p-6 sm:p-10 min-h-[360px] grid place-items-center overflow-hidden">
          <Star className="absolute top-8 right-9 w-9" />
          <CheckBubble className="absolute bottom-8 left-8 w-12" />
          <div className="w-full max-w-[330px] space-y-2.5">
            {[
              ["In 1 week", "Return window · Samsung 65″ TV"],
              ["In 3 days", "Free trial ends · StreamMax"],
              ["Today", "Use your $431 Delta eCredit"],
            ].map(([when, what]) => (
              <div key={when} className="rounded-2xl bg-ink text-white px-4 py-3 shadow-[var(--shadow-pop)]">
                <p className="flex items-center gap-2 text-[11.5px] text-white/55">
                  <span className="grid place-items-center size-4 rounded bg-coral text-[9px] font-bold text-ink">!</span> LIFEOS
                </p>
                <p className="mt-1 text-[14px] font-semibold">{when}: {what}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[15px] font-semibold text-leaf-ink">Reminders</p>
          <h2 className="mt-2 display-2 text-[40px] sm:text-[52px]">We nag, so you don&apos;t have to.</h2>
          <p className="mt-5 text-[18px] text-muted leading-relaxed">
            1 week before. 3 days before. The day of. Every deadline gets a heads-up in the app and by email, at the time you pick. Handled it early? Tap done and we go quiet.
          </p>
        </div>
      </section>

      {/* ── Privacy ── */}
      <section id="privacy" className="mt-24 sm:mt-32 mx-3 sm:mx-5 rounded-[32px] bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 sm:px-10 py-20 sm:py-24">
          <span className="grid place-items-center size-12 rounded-2xl bg-white/10">
            <Lock className="size-5" />
          </span>
          <h2 className="mt-6 display-2 text-[40px] sm:text-[56px]">Your information is yours.</h2>
          <p className="mt-4 text-white/65 max-w-2xl text-[18px] leading-relaxed">Your receipts say a lot about you. Here&apos;s exactly how we handle them.</p>
          <ul className="mt-12 grid md:grid-cols-2 gap-x-12 gap-y-7">
            {[
              ["Private by default", "Files live in private storage and are only served to your signed-in account. No public links."],
              ["Encrypted in transit and at rest", "TLS everywhere, encrypted storage, and an extra layer on credit and confirmation codes."],
              ["Only what's needed goes to AI", "Card numbers, your name and email are stripped first. Policy lookups search the store and product, never you."],
              ["Not used for training", "We never train on your documents, and our AI providers' API terms don't either."],
              ["Delete anytime", "One document, one item, or your whole account, including everything we extracted."],
              ["No bank or inbox login", "You choose exactly what we see. Email is forward-only, and imports are one-time."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-4">
                <span className="grid place-items-center size-7 rounded-full bg-leaf shrink-0 mt-0.5">
                  <Check className="size-4 text-ink" strokeWidth={3} />
                </span>
                <div>
                  <p className="font-semibold text-[16px]">{t}</p>
                  <p className="text-white/60 text-[15px] mt-1 leading-relaxed">{d}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/privacy" className="inline-flex items-center gap-1.5 mt-12 text-[15px] font-medium text-white/85 hover:text-white">
            Read the details <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative mx-auto max-w-4xl px-5 py-28 sm:py-36 text-center">
        <div className="flex justify-center items-end gap-2 sm:gap-4 mb-10">
          <ReceiptBuddy className="w-16 sm:w-20 rotate-[-6deg] spring-hover" />
          <TrialBuddy className="w-16 sm:w-20 spring-hover" />
          <CreditBuddy className="w-20 sm:w-24 spring-hover" />
          <ShieldBuddy className="w-16 sm:w-20 rotate-[6deg] spring-hover" />
        </div>
        <h2 className="display text-[48px] sm:text-[80px]">What are you forgetting?</h2>
        <p className="mt-5 text-muted text-[19px]">Drop in one receipt. See what we find in seconds.</p>
        <Button asChild size="lg" className="mt-10">
          <Link href="/sign-up">
            Find what I&apos;m forgetting <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between text-[14px] text-muted">
          <Logo />
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <span className="inline-flex items-center gap-1.5"><Trash2 className="size-3.5" /> Delete anytime</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Bento({ step, title, body, children }: { step: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[26px] bg-tile p-2 flex flex-col">
      <div className="h-[230px] grid place-items-center px-4">{children}</div>
      <div className="px-5 pb-6 pt-2">
        <p className="text-[12.5px] font-semibold text-subtle tabular">0{step}</p>
        <h3 className="mt-1 font-display text-[20px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-1.5 text-[15px] text-muted leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function FactRow({ label, value, certainty, stacked }: { label: string; value: string; certainty: "confirmed" | "estimated" | "unknown"; stacked?: boolean }) {
  if (stacked) {
    // Narrow cards: label on its own line so nothing gets cut off.
    return (
      <div>
        <p className="text-[12.5px] text-muted">{label}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-[14.5px] font-semibold tabular">{value}</span>
          <CertaintyBadge certainty={certainty} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13.5px] text-muted truncate">{label}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-[14px] font-semibold tabular">{value}</span>
        <CertaintyBadge certainty={certainty} />
      </span>
    </div>
  );
}

function KindTile({ kind, title, value, line, certainty }: { kind: keyof typeof KIND_STYLE; title: string; value: string; line: string; certainty: "confirmed" | "estimated" }) {
  const k = KIND_STYLE[kind];
  return (
    <div className={cn("group relative rounded-[26px] p-5 text-ink min-h-[300px] flex flex-col overflow-hidden press brut", k.bg)}>
      <p className="font-display text-[22px] font-semibold tracking-[-0.02em]">{title}</p>
      <div className="relative my-auto mx-auto grid place-items-center size-40">
        <span className="absolute inset-3 rounded-full bg-white/70" />
        <k.Sticker className="relative w-28 transition-transform duration-300 group-hover:-translate-y-1.5 group-hover:rotate-[-5deg]" />
      </div>
      <div className="rounded-2xl bg-white text-ink p-3.5 border-2 border-ink">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[19px] font-semibold tabular tracking-[-0.02em]">{value}</span>
          <CertaintyBadge certainty={certainty} />
        </div>
        <p className="text-[12.5px] text-muted mt-0.5 truncate">{line}</p>
      </div>
    </div>
  );
}

/** Words slide up into place one by one (Family-style headline reveal). */
function RiseWords({ lines }: { lines: string[] }) {
  let i = 0;
  return (
    <span aria-hidden>
      {lines.map((line) => (
        <span key={line} className="block overflow-hidden pb-[0.08em]">
          {line.split(" ").map((w) => (
            <span key={w + i} className="inline-block animate-word" style={{ animationDelay: `${60 + i++ * 70}ms` }}>
              {w}&nbsp;
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/* ── Hero sticker clusters ── */

function HeroStickersLeft() {
  return (
    <div aria-hidden className="hidden lg:block absolute left-0 top-10 w-[34vw] max-w-[440px] h-[520px] pointer-events-none">
      <div className="absolute left-[8%] top-[22%] size-40 rounded-full bg-tile" />
      <ReceiptBuddy className="absolute left-[18%] top-[18%] w-36 [--tilt:-8deg] animate-pop [animation-delay:240ms] spring-hover pointer-events-auto" />
      <Coin className="absolute left-[58%] top-[6%] w-14 [--tilt:-20deg] animate-pop [animation-delay:330ms] spring-hover pointer-events-auto" />
      <Heart className="absolute left-[64%] top-[40%] w-12 animate-pop [animation-delay:420ms] spring-hover pointer-events-auto" />
      <TrialBuddy className="absolute left-[42%] top-[62%] w-28 [--tilt:8deg] animate-pop [animation-delay:510ms] spring-hover pointer-events-auto" />
      <Star className="absolute left-[6%] top-[70%] w-9 animate-pop [animation-delay:600ms] spring-hover pointer-events-auto" />
      <Sparkle className="absolute left-[80%] top-[20%] w-6 animate-pop [animation-delay:690ms] spring-hover pointer-events-auto" />
      <Dot className="absolute left-[4%] top-[10%] size-8 animate-pop [animation-delay:780ms]" color="var(--color-leaf)" />
      <Dot className="absolute left-[30%] top-[88%] size-10 animate-pop [animation-delay:870ms]" color="var(--color-coral)" />
      <Dot className="absolute left-[82%] top-[62%] size-5 animate-pop [animation-delay:960ms]" color="var(--color-blue)" />
    </div>
  );
}

function HeroStickersRight() {
  return (
    <div aria-hidden className="hidden lg:block absolute right-0 top-10 w-[34vw] max-w-[440px] h-[520px] pointer-events-none">
      <div className="absolute right-[12%] top-[30%] size-44 rounded-full bg-tile" />
      <CreditBuddy className="absolute right-[14%] top-[26%] w-40 [--tilt:6deg] animate-pop [animation-delay:290ms] spring-hover pointer-events-auto" />
      <CheckBubble className="absolute right-[62%] top-[8%] w-14 animate-pop [animation-delay:380ms] spring-hover pointer-events-auto" />
      <ShieldBuddy className="absolute right-[52%] top-[56%] w-28 [--tilt:-6deg] animate-pop [animation-delay:470ms] spring-hover pointer-events-auto" />
      <Star className="absolute right-[10%] top-[6%] w-10 animate-pop [animation-delay:560ms] spring-hover pointer-events-auto" color="var(--color-coral)" />
      <Coin className="absolute right-[6%] top-[76%] w-12 [--tilt:15deg] animate-pop [animation-delay:650ms] spring-hover pointer-events-auto" />
      <Sparkle className="absolute right-[40%] top-[22%] w-7 animate-pop [animation-delay:740ms] spring-hover pointer-events-auto" color="var(--color-sun)" />
      <Dot className="absolute right-[4%] top-[48%] size-7 animate-pop [animation-delay:830ms]" color="var(--color-grape)" />
      <Dot className="absolute right-[78%] top-[86%] size-6 animate-pop [animation-delay:920ms]" color="var(--color-sun)" />
    </div>
  );
}

function MobileStickers() {
  return (
    <div aria-hidden className="lg:hidden flex justify-center items-end gap-1 mb-8 h-28">
      <ReceiptBuddy className="w-20 animate-pop [--tilt:-8deg]" />
      <Coin className="w-9 mb-16 animate-pop [animation-delay:120ms]" />
      <CreditBuddy className="w-24 animate-pop [animation-delay:200ms] [--tilt:4deg]" />
      <ShieldBuddy className="w-16 animate-pop [animation-delay:280ms] [--tilt:8deg]" />
    </div>
  );
}
