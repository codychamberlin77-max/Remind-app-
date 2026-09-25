import { ArrowLeft, CircleAlert, Copy, Eye, FileText, Quote } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActionButtons,
  DeleteDocument,
  DeleteItem,
  FactButtons,
  ItemToolbar,
  NotDuplicateButton,
  RecordOutcome,
} from "@/components/app/item-controls";
import { ReminderPicker } from "@/components/app/reminder-picker";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { CertaintyBadge } from "@/components/ui/certainty";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { daysBetween, formatDate } from "@/server/extraction/dates";
import { isUuid } from "@/server/http/handle";
import { NotFoundError } from "@/server/services/documents";
import { getItem } from "@/server/services/items";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  purchase: "Purchase",
  subscription: "Subscription",
  warranty: "Warranty",
  travel_credit: "Travel credit",
  bill: "Bill",
  appointment: "Appointment",
  document: "Document",
};

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await requireUser();
  let data;
  try {
    data = await getItem(user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { item, facts, actions, document, lineItems, today, duplicateOf, outcomes } = data;
  const headlineFact = facts.find((f) => ["total", "amount", "purchase_price"].includes(f.key) && f.valueCents != null);

  function display(f: (typeof facts)[number]) {
    if (f.certainty === "unknown") return "Unknown";
    if (f.valueCents != null) return formatMoney(f.valueCents, f.currency ?? item.currency ?? "USD");
    if (f.valueDate) {
      const d = daysBetween(today, f.valueDate);
      const isDeadline = ["return_deadline", "warranty", "trial_end", "next_renewal", "warranty_end", "expires_on"].includes(f.key) || f.key.startsWith("date_");
      if (isDeadline && d >= 0) {
        const rel = d === 0 ? "today" : d === 1 ? "tomorrow" : `${d} days remaining`;
        return `${formatDate(f.valueDate)} · ${f.certainty === "estimated" ? "Estimated: " : ""}${rel}`;
      }
      if (isDeadline && d < 0) return `${formatDate(f.valueDate)} · ended`;
      return formatDate(f.valueDate);
    }
    if (f.key === "warranty" && f.valueNumber) return `${f.valueNumber} months`;
    return f.valueText ?? "—";
  }

  return (
    <div className="space-y-8">
      <Link href="/home" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Home
      </Link>

      <header className="animate-rise">
        <p className="text-[13px] text-muted">{KIND_LABEL[item.kind] ?? "Item"}{item.merchant && item.kind !== "subscription" ? ` · ${item.merchant}` : ""}</p>
        <h1 className="mt-1 text-[28px] sm:text-[32px] font-semibold tracking-[-0.03em] leading-tight">{item.title}</h1>
        {headlineFact ? (
          <p className="mt-2 text-[24px] font-semibold tabular tracking-[-0.02em]">
            {formatMoney(headlineFact.valueCents, headlineFact.currency ?? "USD")}
            {typeof item.details.otherItemCount === "number" && item.details.otherItemCount > 0 ? (
              <span className="text-[14px] font-normal text-muted ml-2">total · incl. {item.details.otherItemCount} more {item.details.otherItemCount === 1 ? "item" : "items"}</span>
            ) : null}
          </p>
        ) : null}
        <div className="mt-5"><ItemToolbar itemId={item.id} state={item.state} needsReview={item.needsReview} /></div>
      </header>

      {item.possibleDuplicateOf || item.conflictNote || item.needsReview ? (
        <Card className="p-4 bg-estimated-bg/60 space-y-3">
          {item.possibleDuplicateOf ? (
            <div className="flex items-start justify-between gap-4">
              <p className="text-[14px] text-ink-2 flex gap-2"><Copy className="size-4 mt-0.5 shrink-0 text-estimated" />
                <span>This looks like the same purchase as <Link className="underline" href={`/items/${duplicateOf?.id}`}>{duplicateOf?.title ?? "another item"}</Link>, so we didn&apos;t create duplicate reminders.</span>
              </p>
              <NotDuplicateButton itemId={item.id} />
            </div>
          ) : null}
          {item.conflictNote ? <p className="text-[14px] text-ink-2 flex gap-2"><CircleAlert className="size-4 mt-0.5 shrink-0 text-estimated" />{item.conflictNote} Check which is right.</p> : null}
          {item.needsReview && !item.conflictNote ? <p className="text-[14px] text-ink-2 flex gap-2"><CircleAlert className="size-4 mt-0.5 shrink-0 text-estimated" />Some details were hard to read or couldn&apos;t be verified. Please check the ones marked estimated.</p> : null}
        </Card>
      ) : null}

      {facts.length ? (
        <section>
          <SectionTitle>Details</SectionTitle>
          <Card className="divide-y divide-line">
            {facts.map((f) => (
              <div key={f.id} className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] text-muted">{f.label}</p>
                    <p className={`mt-0.5 text-[16px] font-medium tabular ${f.certainty === "unknown" ? "text-subtle" : ""}`}>{display(f)}</p>
                  </div>
                  <CertaintyBadge certainty={f.certainty} className="shrink-0 mt-0.5" />
                </div>
                {f.explanation ? <p className="mt-2 text-[13.5px] text-muted leading-relaxed">{f.explanation}</p> : null}
                {f.evidence ? (
                  <p className="mt-2 text-[12.5px] text-subtle flex gap-1.5 items-start">
                    <Quote className="size-3 mt-0.5 shrink-0" />
                    <span className="font-[family-name:var(--font-mono)] break-words">{f.evidence}</span>
                  </p>
                ) : null}
                <div className="mt-2 -ml-2">
                  <FactButtons itemId={item.id} factKey={f.key} label={f.label} certainty={f.certainty} userConfirmed={!!f.userConfirmedAt} current={{ valueDate: f.valueDate, valueCents: f.valueCents, valueText: f.valueText }} />
                </div>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {actions.length ? (
        <section>
          <SectionTitle>What to do</SectionTitle>
          <div className="space-y-3">
            {actions.map((a) => (
              <Card key={a.actionId} className={`p-5 ${a.status === "done" || a.status === "dismissed" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[15px] font-semibold">{a.title}</p>
                    <p className="text-[14px] text-ink-2 mt-1">{a.status === "done" ? "Completed." : a.reason}</p>
                    {a.suggestedAction && a.status !== "done" ? <p className="text-[13.5px] text-muted mt-1">{a.suggestedAction}</p> : null}
                  </div>
                  <CertaintyBadge certainty={a.dueCertainty} className="shrink-0" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {a.status !== "done" && a.status !== "dismissed" ? <ReminderPicker actionId={a.actionId} itemId={item.id} dueOn={a.dueOn} reminderAt={a.reminderAt} /> : null}
                  <ActionButtons actionId={a.actionId} itemId={item.id} status={a.status} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {lineItems.length > 1 ? (
        <section>
          <SectionTitle>On this receipt</SectionTitle>
          <Card className="divide-y divide-line">
            {lineItems.map((li, i) => (
              <div key={i} className="px-4 py-3 flex justify-between gap-4 text-[14px]">
                <span className="truncate">{li.name}</span>
                <span className="tabular text-muted shrink-0">{li.totalCents != null ? formatMoney(li.totalCents, item.currency ?? "USD") : ""}</span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {["purchase", "travel_credit", "warranty", "subscription"].includes(item.kind) ? (
        <section>
          <SectionTitle>Money saved</SectionTitle>
          <Card className="p-4">
            {outcomes.length ? (
              <div className="space-y-1.5 mb-3">
                {outcomes.map((o) => (
                  <p key={o.id} className="text-[14px]"><span className="font-semibold tabular text-money">{formatMoney(o.amountCents, o.currency)}</span> <span className="text-muted">confirmed {o.confirmedByUserAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></p>
                ))}
              </div>
            ) : null}
            <RecordOutcome itemId={item.id} kind={item.kind} defaultCents={item.amountCents} />
          </Card>
        </section>
      ) : null}

      {document ? (
        <section>
          <SectionTitle>Source</SectionTitle>
          <Card className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="size-4 text-subtle shrink-0" />
              <div className="min-w-0">
                <p className="text-[14px] font-medium truncate">{document.originalFilename}</p>
                <p className="text-[12.5px] text-subtle">{document.source === "sample" ? "Sample document" : `Added ${document.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}</p>
              </div>
            </div>
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/documents/${document.id}/file`} target="_blank" rel="noopener"><Eye className="size-3.5" /> View</a>
            </Button>
          </Card>
        </section>
      ) : null}

      <div className="pt-4 border-t border-line flex flex-wrap gap-2">
        <DeleteItem itemId={item.id} />
        {document ? <DeleteDocument documentId={document.id} redirectTo="/home" /> : null}
      </div>
    </div>
  );
}
