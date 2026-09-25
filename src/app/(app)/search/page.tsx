import { FileText, Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { search } from "@/server/services/search";

export const metadata = { title: "Search" };
export const dynamic = "force-dynamic";

const EXAMPLES = ["What expires this month?", "Show my warranties", "How much am I currently tracking?", "Which purchases have warranties?", "Subscriptions"];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").slice(0, 200);
  const res = q ? await search(user.id, q) : null;

  return (
    <div>
      <form action="/search" className="relative">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-subtle" />
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Search your purchases, deadlines, warranties…"
          className="w-full h-13 py-3.5 pl-11 pr-4 rounded-2xl bg-surface shadow-[var(--shadow-card)] text-[16px] placeholder:text-subtle focus:outline-none focus:shadow-[var(--shadow-pop)] transition-shadow"
        />
      </form>

      {!res ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <Link key={e} href={`/search?q=${encodeURIComponent(e)}`} className="h-8 px-3 inline-flex items-center rounded-full bg-surface shadow-[var(--shadow-card)] text-[13px] text-muted hover:text-ink">
              {e}
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8 animate-fade">
          <p className="text-[13px] text-muted px-1">{res.interpretation}</p>
          {res.total ? (
            <Card className="mt-3 p-5">
              <p className="text-[13px] text-muted">{res.total.label}</p>
              <p className="text-[28px] font-semibold tracking-[-0.02em] tabular mt-0.5">{formatMoney(res.total.cents, res.total.currency)}</p>
              <p className="text-[12.5px] text-subtle">{res.total.count} {res.total.count === 1 ? "item" : "items"}</p>
            </Card>
          ) : null}
          {res.results.length ? (
            <Card className="mt-3 divide-y divide-line overflow-hidden">
              {res.results.map((r, i) => (
                <Link key={`${r.itemId}-${i}`} href={`/items/${r.itemId}`} className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-hover">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium truncate">{r.title}</p>
                    <p className="text-[13px] text-muted truncate">{[r.merchant, r.line].filter(Boolean).join(" · ")}</p>
                  </div>
                  {r.amount ? <span className="text-[14px] tabular shrink-0">{r.amount}</span> : null}
                </Link>
              ))}
            </Card>
          ) : (
            <Card className="mt-3 p-6 text-center text-[14.5px] text-muted">Nothing matched.</Card>
          )}
          {res.documents.length ? (
            <>
              <p className="text-[13px] text-muted px-1 mt-8">Documents</p>
              <Card className="mt-3 divide-y divide-line overflow-hidden">
                {res.documents.map((d) => (
                  <a key={d.id} href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener" className="flex items-center gap-3 px-4 py-3.5 hover:bg-hover text-[14px]">
                    <FileText className="size-4 text-subtle" /> {d.filename}
                  </a>
                ))}
              </Card>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
