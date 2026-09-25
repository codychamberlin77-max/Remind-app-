"use client";
import * as Popover from "@radix-ui/react-popover";
import { Bell, BellRing, Check } from "lucide-react";
import { useState, useTransition } from "react";
import { setReminderAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const PRESETS = [
  { id: "today", label: "Later today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "3_days_before", label: "3 days before", needsDue: true },
  { id: "1_week_before", label: "1 week before", needsDue: true },
] as const;

export function ReminderPicker({
  actionId,
  itemId,
  dueOn,
  reminderAt,
  size = "sm",
  variant = "secondary",
  label,
}: {
  actionId: string;
  itemId?: string;
  dueOn: string | null;
  reminderAt?: Date | string | null;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost" | "primary";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = !!reminderAt || !!done;

  function choose(preset: string, customDate?: string) {
    setError(null);
    start(async () => {
      const r = await setReminderAction({ actionId, preset, customDate: customDate ?? null, itemId });
      if (r.ok) {
        setDone(r.message ?? "Reminder set.");
        setTimeout(() => setOpen(false), 700);
      } else setError(r.error);
    });
  }

  const when = reminderAt ? new Date(reminderAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size={size} variant={variant}>
          {set ? <BellRing className="size-3.5" /> : <Bell className="size-3.5" />}
          {label ?? (when ? `Reminder · ${when}` : set ? "Reminder set" : "Remind me")}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-[250px] rounded-2xl bg-surface p-1.5 shadow-[var(--shadow-pop)] animate-rise">
          {done ? (
            <p className="flex items-center gap-2 px-3 py-3 text-[13.5px] text-confirmed">
              <Check className="size-4" /> {done}
            </p>
          ) : (
            <>
              <p className="px-3 pt-2 pb-1.5 text-[12px] text-subtle">Remind me</p>
              {PRESETS.filter((p) => !("needsDue" in p) || dueOn).map((p) => (
                <button
                  key={p.id}
                  disabled={pending}
                  onClick={() => choose(p.id)}
                  className={cn("w-full text-left px-3 h-9 rounded-lg text-[14px] hover:bg-hover disabled:opacity-50", p.id === "3_days_before" && "font-medium")}
                >
                  {p.label}
                </button>
              ))}
              <div className="mt-1 pt-2 border-t border-line px-2 pb-1.5 flex gap-1.5">
                <input
                  type="date"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="flex-1 min-w-0 h-9 rounded-lg border border-line-strong px-2 text-[13px]"
                  aria-label="Custom date"
                />
                <Button size="sm" variant="secondary" disabled={!custom || pending} onClick={() => choose("custom", custom)} className="h-9">
                  Set
                </Button>
              </div>
              {error ? <p className="px-3 pb-2 text-[12.5px] text-urgent">{error}</p> : null}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
