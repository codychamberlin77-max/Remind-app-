"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Shown while the worker looks up a store/brand policy; refreshes the page until it's done. */
export function PolicyPending({ merchant, brand }: { merchant?: string; brand?: string }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 30) return clearInterval(t); // stop after ~2 minutes
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [router]);
  const what = [merchant ? `${merchant}'s return policy` : null, brand ? `${brand}'s warranty` : null].filter(Boolean).join(" and ");
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-blue-soft px-4 py-3.5 text-[14px] text-ink-2">
      <Loader2 className="size-4 animate-spin text-blue shrink-0" />
      <span>Looking up {what || "the store's policies"}…</span>
    </div>
  );
}
