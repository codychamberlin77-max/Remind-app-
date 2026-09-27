import Link from "next/link";
import { cn } from "@/lib/cn";

/** Four tiles = the four things LIFEOS watches: purchases, trials, credits, warranties. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      <rect x="1" y="1" width="10" height="10" rx="3.2" fill="var(--color-blue)" />
      <rect x="13" y="1" width="10" height="10" rx="5" fill="var(--color-grape)" />
      <rect x="1" y="13" width="10" height="10" rx="5" fill="var(--color-coral)" />
      <rect x="13" y="13" width="10" height="10" rx="3.2" fill="var(--color-leaf)" />
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
