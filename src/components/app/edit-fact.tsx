"use client";
import { useState, useTransition } from "react";
import { editFactAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";

const DATE_KEYS = new Set(["purchase_date", "return_deadline", "warranty", "trial_end", "next_renewal", "warranty_end", "expires_on", "start_date"]);
const MONEY_KEYS = new Set(["total", "amount", "purchase_price"]);

export function EditFact({
  itemId,
  factKey,
  label,
  current,
  trigger,
}: {
  itemId: string;
  factKey: string;
  label: string;
  current: { valueDate?: string | null; valueCents?: number | null; valueText?: string | null };
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const kind = DATE_KEYS.has(factKey) || /^date_\d+_/.test(factKey) ? "date" : MONEY_KEYS.has(factKey) ? "money" : "text";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("value") ?? "").trim();
    setError(null);
    start(async () => {
      const payload =
        kind === "date"
          ? { valueDate: v }
          : kind === "money"
            ? { valueCents: Math.round(Number(v.replace(/[^0-9.]/g, "")) * 100) }
            : { valueText: v };
      if (kind === "money" && !Number.isFinite(payload.valueCents)) return setError("Enter an amount.");
      const r = await editFactAction({ itemId, key: factKey, ...payload });
      if (r.ok) setOpen(false);
      else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={`Edit ${label.toLowerCase()}`} description="Your correction replaces what we found, and reminders update to match.">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="value">{label}</Label>
            {kind === "date" ? (
              <Input id="value" name="value" type="date" required defaultValue={current.valueDate ?? ""} />
            ) : kind === "money" ? (
              <Input id="value" name="value" inputMode="decimal" required placeholder="0.00" defaultValue={current.valueCents != null ? (current.valueCents / 100).toFixed(2) : ""} />
            ) : (
              <Input id="value" name="value" required maxLength={200} defaultValue={current.valueText ?? ""} />
            )}
          </div>
          {error ? <p className="text-[13px] text-urgent">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
