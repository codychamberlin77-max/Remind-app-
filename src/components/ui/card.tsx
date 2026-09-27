import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-tile rounded-[var(--radius-card)]", className)} {...props} />;
}

export function SectionTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-ink">
        {children}
        {count ? <span className="ml-2 text-subtle font-normal tabular">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}
