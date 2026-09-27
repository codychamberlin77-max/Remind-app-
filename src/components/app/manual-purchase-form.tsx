"use client";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addManualPurchaseAction } from "@/app/(app)/actions";
import { ReceiptBuddy } from "@/components/brand/stickers";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const WHEN = [
  ["exact", "I know the date"],
  ["approx", "Roughly"],
  ["unknown", "Not sure"],
] as const;

export function ManualPurchaseForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState<"exact" | "approx" | "unknown">("exact");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-rise">
      <Link href="/add" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Add
      </Link>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="display-2 text-[34px] sm:text-[46px]">Lost the receipt?</h1>
          <p className="text-muted mt-2.5 text-[16px] max-w-md">Tell us what you bought and where. We&apos;ll look up the store&apos;s return policy and the manufacturer&apos;s warranty for you.</p>
        </div>
        <ReceiptBuddy className="hidden sm:block w-24 shrink-0 rotate-[8deg]" />
      </div>

      <form
        className="mt-8 space-y-5 rounded-[28px] bg-tile p-5 sm:p-7"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const r = await addManualPurchaseAction({
              item: String(f.get("item") ?? ""),
              store: String(f.get("store") ?? ""),
              purchaseDate: when === "unknown" ? null : String(f.get("date") ?? "") || null,
              dateCertainty: when,
              price: String(f.get("price") ?? ""),
            });
            if (!r.ok) setError(r.error);
            else router.push(`/items/${r.itemId}`);
          });
        }}
      >
        <div>
          <Label htmlFor="item">What did you buy?</Label>
          <Input id="item" name="item" required minLength={2} maxLength={120} placeholder="e.g. Samsung 65-inch TV" className="bg-surface" />
        </div>
        <div>
          <Label htmlFor="store">Where did you buy it?</Label>
          <Input id="store" name="store" required minLength={2} maxLength={80} placeholder="e.g. Target" className="bg-surface" />
        </div>
        <div>
          <Label>When?</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {WHEN.map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={when === v}
                onClick={() => setWhen(v)}
                className={cn("h-10 px-4 rounded-full text-[14px] font-medium press", when === v ? "bg-ink text-white" : "bg-surface text-ink-2")}
              >
                {label}
              </button>
            ))}
          </div>
          {when !== "unknown" ? (
            <Input id="date" name="date" type="date" required max={today} aria-label="Purchase date" className="mt-3 bg-surface" />
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">We&apos;ll still show the store&apos;s policy. Add the date later to get your deadlines.</p>
          )}
          {when === "approx" ? <p className="mt-2 text-[13px] text-muted">Pick your best guess. Deadlines will be marked estimated.</p> : null}
        </div>
        <div>
          <Label htmlFor="price">Price (optional)</Label>
          <Input id="price" name="price" inputMode="decimal" placeholder="e.g. 499.99" className="bg-surface" />
        </div>
        {error ? <p className="text-[14px] text-urgent">{error}</p> : null}
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Find my return window &amp; warranty <ArrowRight className="size-4" />
        </Button>
      </form>
      <p className="mt-4 text-[12.5px] text-subtle">Only the store, brand and product type are used to search the web. Nothing about you is shared.</p>
    </div>
  );
}
