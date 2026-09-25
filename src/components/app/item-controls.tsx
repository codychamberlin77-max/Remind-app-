"use client";
import { Bookmark, BookmarkCheck, Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import {
  actionStatusAction,
  clearDuplicateAction,
  confirmFactAction,
  deleteDocumentAction,
  deleteItemAction,
  itemStateAction,
  markReviewedAction,
  recordOutcomeAction,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { EditFact } from "./edit-fact";

export function FactButtons({
  itemId,
  factKey,
  label,
  certainty,
  userConfirmed,
  current,
}: {
  itemId: string;
  factKey: string;
  label: string;
  certainty: string;
  userConfirmed: boolean;
  current: { valueDate?: string | null; valueCents?: number | null; valueText?: string | null };
}) {
  const [pending, start] = useTransition();
  const editable = /^(purchase_date|return_deadline|warranty|trial_end|next_renewal|warranty_end|expires_on|start_date|total|amount|purchase_price|merchant|date_\d+_\w+)$/.test(factKey);
  return (
    <div className="flex gap-1.5">
      {certainty !== "unknown" && !userConfirmed ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await confirmFactAction(itemId, factKey); })}>
          <Check className="size-3.5" /> Looks right
        </Button>
      ) : null}
      {editable ? (
        <EditFact
          itemId={itemId}
          factKey={factKey}
          label={label}
          current={current}
          trigger={<Button size="sm" variant="ghost">{certainty === "unknown" ? "Add" : <><Pencil className="size-3.5" /> Edit</>}</Button>}
        />
      ) : null}
    </div>
  );
}

export function ActionButtons({ actionId, itemId, status }: { actionId: string; itemId: string; status: string }) {
  const [pending, start] = useTransition();
  if (status === "done" || status === "dismissed") {
    return (
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await actionStatusAction(actionId, "open", itemId); })}>
        <RotateCcw className="size-3.5" /> Reopen
      </Button>
    );
  }
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await actionStatusAction(actionId, "done", itemId); })}>
      <Check className="size-3.5" /> Mark complete
    </Button>
  );
}

export function ItemToolbar({ itemId, state, needsReview }: { itemId: string; state: string; needsReview: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {needsReview ? (
        <Button size="sm" disabled={pending} onClick={() => start(async () => { await markReviewedAction(itemId); })}>
          <Check className="size-3.5" /> Everything looks right
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await itemStateAction(itemId, state === "saved" ? "active" : "saved"); })}>
        {state === "saved" ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />} {state === "saved" ? "Saved" : "Save"}
      </Button>
    </div>
  );
}

export function NotDuplicateButton({ itemId }: { itemId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await clearDuplicateAction(itemId); })}>
      Not a duplicate
    </Button>
  );
}

export function ConfirmDelete({ label, description, onConfirm, trigger }: { label: string; description: string; onConfirm: () => Promise<unknown>; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="danger"><Trash2 className="size-3.5" /> {label}</Button>}</DialogTrigger>
      <DialogContent title={`${label}?`} description={description}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { await onConfirm(); setOpen(false); })}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteItem({ itemId }: { itemId: string }) {
  return <ConfirmDelete label="Delete item" description="This removes the item, its reminders and extracted details. The source document stays." onConfirm={() => deleteItemAction(itemId)} />;
}

export function DeleteDocument({ documentId, redirectTo }: { documentId: string; redirectTo?: string }) {
  return (
    <ConfirmDelete
      label="Delete document"
      description="This permanently deletes the file and everything we extracted from it, including reminders."
      onConfirm={() => deleteDocumentAction(documentId, redirectTo)}
    />
  );
}

const OUTCOMES: Record<string, { kind: string; question: string }> = {
  purchase: { kind: "return_completed", question: "Returned it? Record what you got back." },
  travel_credit: { kind: "credit_used", question: "Used this credit? Record the value you used." },
  warranty: { kind: "warranty_claim_paid", question: "Made a claim? Record what it covered." },
  subscription: { kind: "cancelled_before_charge", question: "Cancelled before being charged? Record what you avoided paying." },
};

/** Money Saved is only ever recorded by the user. */
export function RecordOutcome({ itemId, kind, defaultCents }: { itemId: string; kind: string; defaultCents: number | null }) {
  const o = OUTCOMES[kind];
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!o) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-left w-full text-[14px] text-muted hover:text-ink">{o.question}</button>
      </DialogTrigger>
      <DialogContent title="Record money saved" description="Only amounts you confirm count toward Money Saved.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(String(new FormData(e.currentTarget).get("amount")).replace(/[^0-9.]/g, ""));
            start(async () => {
              const r = await recordOutcomeAction({ itemId, kind: o.kind, amountCents: Math.round(v * 100) });
              if (r.ok) setOpen(false);
              else setError(r.error);
            });
          }}
        >
          <div>
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" name="amount" inputMode="decimal" required defaultValue={defaultCents ? (defaultCents / 100).toFixed(2) : ""} />
          </div>
          {error ? <p className="text-[13px] text-urgent">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
