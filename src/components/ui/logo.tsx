import Link from "next/link";

/** Temporary wordmark for the internal codename. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-[-0.02em] text-[15px]">
      <span className="grid place-items-center size-6 rounded-[7px] bg-ink text-white text-[11px] font-bold">L</span>
      LIFEOS
    </Link>
  );
}
