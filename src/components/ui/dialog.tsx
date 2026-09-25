"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] animate-fade" />
      <D.Content
        className={cn(
          "fixed z-50 left-1/2 bottom-0 sm:bottom-auto sm:top-1/2 -translate-x-1/2 sm:-translate-y-1/2 w-full sm:w-[440px] max-h-[90dvh] overflow-auto",
          "bg-surface rounded-t-[20px] sm:rounded-[20px] shadow-[var(--shadow-pop)] p-6 animate-rise",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <D.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</D.Title>
            {description ? <D.Description className="text-sm text-muted mt-1">{description}</D.Description> : null}
          </div>
          <D.Close className="text-subtle hover:text-ink -m-1 p-1 rounded-md" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
