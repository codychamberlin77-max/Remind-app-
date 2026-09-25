import { cn } from "@/lib/cn";
import type { Certainty } from "@/server/domain/types";

const styles: Record<Certainty, { label: string; cls: string; dot: string }> = {
  confirmed: { label: "Confirmed", cls: "text-confirmed bg-confirmed-bg", dot: "bg-confirmed" },
  estimated: { label: "Estimated", cls: "text-estimated bg-estimated-bg", dot: "bg-estimated" },
  unknown: { label: "Unknown", cls: "text-unknown bg-unknown-bg", dot: "border border-unknown bg-transparent" },
};

/** Every displayed fact carries one of these. Uncertainty is never hidden. */
export function CertaintyBadge({ certainty, className }: { certainty: Certainty; className?: string }) {
  const s = styles[certainty];
  return (
    <span className={cn("inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11.5px] font-medium", s.cls, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}
