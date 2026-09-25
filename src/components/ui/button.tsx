import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black active:bg-black shadow-[0_1px_0_rgb(255_255_255/0.08)_inset]",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-hover",
  ghost: "text-ink-2 hover:bg-hover",
  quiet: "text-muted hover:text-ink",
  danger: "bg-surface text-urgent border border-line-strong hover:bg-urgent-bg",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[11px]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-[13px]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", asChild, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
