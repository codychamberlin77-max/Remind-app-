"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, CreditCard, FileText, MoreHorizontal, Plane, ReceiptText, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { actionStatusAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { CertaintyBadge } from "@/components/ui/certainty";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import type { ActionCard as Card } from "@/server/services/items";
import { ReminderPicker } from "./reminder-picker";

const ICONS: Record<string, typeof Check> = {
  return: RotateCcw,
  cancel_trial: CreditCard,
  review_renewal: CreditCard,
  use_credit: Plane,
  warranty_expiring: ShieldCheck,
  pay_bill: ReceiptText,
};

function dueLabel(c: Card) {
  if (!c.dueOn || !c.relative) return null;
  return `${c.relative.charAt(0).toUpperCase()}${c.relative.slice(1)}`;
}

export function AttentionCard({ c }: { c: Card }) {
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const Icon = ICONS[c.type] ?? FileText;
  const urgent = c.relative === "today" || c.relative === "tomorrow";
  if (gone) return null;

  return (
    <div className="bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 transition-opacity" style={{ opacity: pending ? 0.5 : 1 }}>
      <div className="flex items-start gap-4">
        <span className={cn("grid place-items-center size-10 rounded-xl shrink-0", urgent ? "bg-urgent-bg text-urgent" : "bg-canvas text-ink-2")}>
          <Icon className="size-[18px]" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/items/${c.itemId}`} className="min-w-0 group">
              <p className="text-[15.5px] font-semibold tracking-[-0.01em] leading-snug group-hover:underline underline-offset-2 decoration-line-strong">{c.title}</p>
            </Link>
            {c.valueCents != null ? <p className="text-[15px] font-semibold tabular shrink-0">{formatMoney(c.valueCents, c.currency ?? "USD")}</p> : null}
          </div>
          <p className="text-[14.5px] text-ink-2 mt-1 leading-relaxed">{c.reason}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {dueLabel(c) ? <span className={cn("text-[12.5px] font-medium", urgent ? "text-urgent" : "text-muted")}>{dueLabel(c)}</span> : null}
            <CertaintyBadge certainty={c.dueCertainty} />
            {c.needsReview ? <span className="text-[12px] text-estimated">Needs a quick check</span> : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ReminderPicker actionId={c.actionId} itemId={c.itemId} dueOn={c.dueOn} reminderAt={c.reminderAt} />
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await actionStatusAction(c.actionId, "done", c.itemId); if (r.ok) setGone(true); })}>
              <Check className="size-3.5" /> Done
            </Button>
            <Overflow onChoose={(s) => start(async () => { const r = await actionStatusAction(c.actionId, s, c.itemId); if (r.ok) setGone(true); })} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompactRow({ c }: { c: Card }) {
  const Icon = ICONS[c.type] ?? FileText;
  return (
    <Link href={`/items/${c.itemId}`} className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-hover transition-colors">
      <Icon className="size-4 text-subtle shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[14.5px] font-medium truncate">{c.title}</p>
        <p className="text-[13px] text-muted truncate">{c.reason}</p>
      </div>
      <div className="text-right shrink-0">
        {c.valueCents != null ? <p className="text-[13.5px] font-medium tabular">{formatMoney(c.valueCents, c.currency ?? "USD")}</p> : null}
        {c.dueCertainty === "estimated" ? <p className="text-[11.5px] text-estimated">Estimated</p> : null}
      </div>
    </Link>
  );
}

function Overflow({ onChoose }: { onChoose: (s: "snoozed" | "dismissed") => void }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button size="sm" variant="ghost" aria-label="More"><MoreHorizontal className="size-4" /></Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-50 min-w-[180px] rounded-xl bg-surface p-1 shadow-[var(--shadow-pop)] animate-rise">
          <Dropdown.Item onSelect={() => onChoose("snoozed")} className="px-3 h-9 flex items-center rounded-lg text-[14px] outline-none data-[highlighted]:bg-hover cursor-default">Snooze 3 days</Dropdown.Item>
          <Dropdown.Item onSelect={() => onChoose("dismissed")} className="px-3 h-9 flex items-center rounded-lg text-[14px] outline-none data-[highlighted]:bg-hover cursor-default">Not relevant</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
