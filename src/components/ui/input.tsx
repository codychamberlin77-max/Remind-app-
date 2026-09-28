import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-[14px] border border-transparent bg-hover px-4 text-[15px] placeholder:text-subtle",
        "focus:outline-none focus:bg-surface focus:border-blue-ink focus:ring-4 focus:ring-blue/15 transition",
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
