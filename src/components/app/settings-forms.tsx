"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelReminderAction, deleteAccountAction, deleteAllDataAction, updatePreferencesAction, updateProfileAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ProfileForm({ name, timezone, timezones }: { name: string; timezone: string; timezones: string[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await updateProfileAction({ name: String(fd.get("name")), timezone: String(fd.get("timezone")) });
          setMsg(r.ok ? "Saved." : r.error);
        });
      }}
    >
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={name} maxLength={80} />
      </div>
      <div>
        <Label htmlFor="timezone">Timezone</Label>
        <select id="timezone" name="timezone" defaultValue={timezone} className="h-11 w-full rounded-[11px] border border-line-strong bg-surface px-3 text-[15px]">
          {timezones.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
        </select>
        <p className="text-[12.5px] text-subtle mt-1.5">Deadlines are counted in your local days.</p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>Save</Button>
        {msg ? <span className="text-[13px] text-muted">{msg}</span> : null}
      </div>
    </form>
  );
}

export function NotificationForm({ emailEnabled, inAppEnabled, deliveryHour }: { emailEnabled: boolean; inAppEnabled: boolean; deliveryHour: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState({ emailEnabled, inAppEnabled, deliveryHour });
  const save = (next: typeof state) => {
    setState(next);
    start(async () => { await updatePreferencesAction(next); });
  };
  return (
    <div className="space-y-4" aria-busy={pending}>
      <Toggle label="Email reminders" hint="Sent to your account email." checked={state.emailEnabled} onChange={(v) => save({ ...state, emailEnabled: v })} />
      <Toggle label="In-app reminders" hint="Shown in LIFEOS." checked={state.inAppEnabled} onChange={(v) => save({ ...state, inAppEnabled: v })} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[14.5px] font-medium">Delivery time</p>
          <p className="text-[12.5px] text-subtle">When reminders arrive, in your timezone.</p>
        </div>
        <select value={state.deliveryHour} onChange={(e) => save({ ...state, deliveryHour: Number(e.target.value) })} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[14px]">
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{new Date(2026, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}</option>)}
        </select>
      </div>
      <p className="text-[12.5px] text-subtle">Push notifications and SMS are coming later.</p>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span>
        <span className="block text-[14.5px] font-medium">{label}</span>
        <span className="block text-[12.5px] text-subtle">{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-10 rounded-full transition-colors ${checked ? "bg-ink" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}

export function CancelReminder({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await cancelReminderAction(id); })}>Cancel</Button>;
}

export function DangerZone() {
  return (
    <div className="space-y-3">
      <TypeToConfirm
        label="Delete all my data"
        description="Deletes every document, file, item, reminder, and extracted detail. Your account stays."
        run={deleteAllDataAction}
      />
      <TypeToConfirm label="Delete my account" description="Permanently deletes your account and everything in it. This can't be undone." run={deleteAccountAction} signOut />
    </div>
  );
}

function TypeToConfirm({ label, description, run, signOut }: { label: string; description: string; run: (c: string) => Promise<{ ok: boolean; error?: string } | undefined>; signOut?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[14.5px] font-medium">{label}</p>
            <p className="text-[12.5px] text-subtle">{description}</p>
          </div>
          <Button size="sm" variant="danger">{label.replace("my ", "")}</Button>
        </div>
      </DialogTrigger>
      <DialogContent title={`${label}?`} description={description}>
        <Label htmlFor="confirm">Type DELETE to confirm</Label>
        <Input id="confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        {err ? <p className="text-[13px] text-urgent mt-2">{err}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={text !== "DELETE" || pending}
            onClick={() =>
              start(async () => {
                if (signOut) await authClient.signOut().catch(() => undefined);
                const r = await run(text);
                if (r && !r.ok) setErr(r.error ?? "Failed");
                else { setOpen(false); router.refresh(); }
              })
            }
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SignOut() {
  const router = useRouter();
  return <Button variant="secondary" size="sm" onClick={async () => { await authClient.signOut(); router.push("/"); router.refresh(); }}>Sign out</Button>;
}
