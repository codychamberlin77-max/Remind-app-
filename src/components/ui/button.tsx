import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black",
  secondary: "bg-hover text-ink hover:bg-line-strong/70",
  ghost: "text-ink-2 hover:bg-hover",
  quiet: "text-muted hover:text-ink",
  danger: "bg-urgent-bg text-urgent hover:bg-urgent/15",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5 rounded-full",
  md: "h-10 px-5 text-sm gap-2 rounded-full",
  lg: "h-[52px] px-7 text-[16px] gap-2 rounded-full",
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
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.96] select-none disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
