import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-[11px] border border-line-strong bg-surface px-3.5 text-[15px] placeholder:text-subtle",
        "focus:outline-none focus:border-ink focus:ring-4 focus:ring-black/5 transition",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2 mb-1.5">
      {children}
    </label>
  );
}
