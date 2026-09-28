import Link from "next/link";
import { cn } from "@/lib/cn";

/** Four tiles = the four things LIFEOS watches: purchases, trials, credits, warranties. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      <rect x="1.5" y="1.5" width="9.5" height="9.5" rx="3" fill="var(--color-blue)" stroke="var(--color-ink)" strokeWidth="1.6" />
      <rect x="13" y="1.5" width="9.5" height="9.5" rx="4.75" fill="var(--color-grape)" stroke="var(--color-ink)" strokeWidth="1.6" />
      <rect x="1.5" y="13" width="9.5" height="9.5" rx="4.75" fill="var(--color-coral)" stroke="var(--color-ink)" strokeWidth="1.6" />
      <rect x="13" y="13" width="9.5" height="9.5" rx="3" fill="var(--color-leaf)" stroke="var(--color-ink)" strokeWidth="1.6" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-display font-semibold tracking-[-0.03em] text-[17px] press">
      <LogoMark />
      LIFEOS
    </Link>
  );
}
