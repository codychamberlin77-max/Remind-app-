import { ArrowRight, Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AttentionCard, CompactRow } from "@/components/app/action-card";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { getDashboard } from "@/server/services/items";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const d = await getDashboard(user.id);
  if (d.counts.documents === 0) redirect("/welcome");

  const attention = d.needsAttention;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: user.timezone }).format(new Date()));

  return (
    <div className="space-y-10">
      <header className="animate-rise">
        <p className="text-[14px] text-muted">{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, {user.name.split(" ")[0]}</p>
        <h1 className="mt-1 text-[28px] sm:text-[32px] font-semibold tracking-[-0.03em] leading-tight">
          {attention.length === 0
            ? "Nothing needs your attention right now."
            : attention.length === 1
              ? "One thing needs your attention."
              : `${attention.length} things need your attention.`}
        </h1>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Card className="p-4">
            <p className="text-[12.5px] text-muted flex items-center gap-1.5">
              Money protected
              <span title="The value of purchases and credits with an open return window, warranty, or expiry that we're tracking. This is not money saved." className="cursor-help"><Info className="size-3.5 text-subtle" /></span>
            </p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-money tabular">{formatMoney(d.money.protectedCents, d.money.currency)}</p>
            <p className="text-[12px] text-subtle">{d.money.itemCount} {d.money.itemCount === 1 ? "item" : "items"} with an open window</p>
          </Card>
          <Card className="p-4">
            {d.money.savedCents > 0 ? (
              <>
                <p className="text-[12.5px] text-muted">Money saved</p>
                <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular">{formatMoney(d.money.savedCents, d.money.currency)}</p>
                <p className="text-[12px] text-subtle">Confirmed by you</p>
              </>
            ) : (
              <>
                <p className="text-[12.5px] text-muted">Tracking</p>
                <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular">{d.counts.items}</p>
                <p className="text-[12px] text-subtle">{d.counts.items === 1 ? "item" : "items"} from {d.counts.documents} {d.counts.documents === 1 ? "document" : "documents"}</p>
              </>
            )}
          </Card>
        </div>
      </header>

      {d.processing.length ? (
        <Card className="p-4 flex items-center gap-3 text-[14px]">
          <Loader2 className="size-4 animate-spin text-subtle" />
          Reading {d.processing.length === 1 ? d.processing[0]!.originalFilename : `${d.processing.length} documents`}…
        </Card>
      ) : null}

      <section>
        <SectionTitle count={attention.length}>Needs attention</SectionTitle>
        {attention.length ? (
          <div className="space-y-3">{attention.map((c) => <AttentionCard key={c.actionId} c={c} />)}</div>
        ) : (
          <Card className="p-6 text-center text-[14.5px] text-muted">You&apos;re clear. We&apos;ll surface anything time-sensitive here.</Card>
        )}
      </section>

      {d.comingUp.length ? (
        <section>
          <SectionTitle count={d.comingUp.length}>Coming up</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">{d.comingUp.map((c) => <CompactRow key={c.actionId} c={c} />)}</Card>
        </section>
      ) : null}

      {d.recentlyDiscovered.length ? (
        <section>
          <SectionTitle>Recently discovered</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-3">
            {d.recentlyDiscovered.map((i) => (
              <Link key={i.id} href={`/items/${i.id}`} className="block">
                <Card className="p-4 h-full hover:shadow-[var(--shadow-pop)] transition-shadow">
                  <p className="text-[12px] text-subtle capitalize">{i.kind.replace("_", " ")}</p>
                  <p className="text-[14.5px] font-medium mt-1 line-clamp-2">{i.title}</p>
                  {i.headline ? <p className="text-[13px] text-muted mt-1 tabular">{i.headline}</p> : null}
                  {i.needsReview ? <p className="text-[12px] text-estimated mt-2">Needs a quick check</p> : null}
                  {i.possibleDuplicate ? <p className="text-[12px] text-subtle mt-2">Possible duplicate</p> : null}
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {d.later.length ? (
        <section>
          <SectionTitle count={d.later.length}>Later</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">{d.later.map((c) => <CompactRow key={c.actionId} c={c} />)}</Card>
        </section>
      ) : null}

      {d.saved.length ? (
        <section>
          <SectionTitle>Saved</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {d.saved.map((i) => (
              <Link key={i.id} href={`/items/${i.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-hover">
                <span className="text-[14.5px] truncate">{i.title}</span>
                <span className="text-[13px] text-muted tabular shrink-0 ml-3">{i.headline}</span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}

      <Card className="p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-[15px]">Got more?</p>
          <p className="text-[13.5px] text-muted">Receipts, subscription emails, credits, warranties.</p>
        </div>
        <Button asChild variant="secondary"><Link href="/add">Add <ArrowRight className="size-3.5" /></Link></Button>
      </Card>
    </div>
  );
}
