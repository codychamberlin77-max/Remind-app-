import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function SectionTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <h2 className="text-[13px] font-semibold tracking-[0.01em] text-ink-2">
        {children}
        {count ? <span className="ml-2 text-subtle font-normal tabular">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}
