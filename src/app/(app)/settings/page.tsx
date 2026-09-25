import { CancelReminder, DangerZone, NotificationForm, ProfileForm, SignOut } from "@/components/app/settings-forms";
import { Card, SectionTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { getPreferences, listReminders } from "@/server/services/reminders";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await requireUser();
  const [prefs, reminders] = await Promise.all([getPreferences(user.id), listReminders(user.id)]);
  const timezones = Intl.supportedValuesOf("timeZone");
  const upcoming = reminders.filter((r) => r.status === "scheduled");
  const history = reminders.filter((r) => r.status !== "scheduled").slice(-20).reverse();
  const fmt = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: user.timezone });

  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Settings</h1>
          <p className="text-muted text-[14px] mt-1">{user.email}</p>
        </div>
        <SignOut />
      </div>

      <section>
        <SectionTitle>Profile</SectionTitle>
        <Card className="p-5"><ProfileForm name={user.name} timezone={user.timezone} timezones={timezones} /></Card>
      </section>

      <section>
        <SectionTitle>Reminders</SectionTitle>
        <Card className="p-5"><NotificationForm {...prefs} /></Card>
      </section>

      <section>
        <SectionTitle count={upcoming.length}>Scheduled reminders</SectionTitle>
        <Card className="divide-y divide-line">
          {upcoming.length === 0 ? <p className="p-5 text-[14px] text-muted">No reminders scheduled.</p> : null}
          {upcoming.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14.5px] truncate">{r.actionTitle}</p>
                <p className="text-[12.5px] text-subtle">{fmt(r.remindAt)} · {r.channels.join(" + ").replace("in_app", "in-app")}</p>
              </div>
              <CancelReminder id={r.id} />
            </div>
          ))}
        </Card>
      </section>

      {history.length ? (
        <section>
          <SectionTitle>Reminder history</SectionTitle>
          <Card className="divide-y divide-line">
            {history.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <p className="text-[14px] truncate">{r.actionTitle}</p>
                <p className="text-[12.5px] text-subtle capitalize">{r.status}{r.sentAt ? ` · ${fmt(r.sentAt)}` : ""}</p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle>Your data</SectionTitle>
        <Card className="p-5"><DangerZone /></Card>
      </section>
    </div>
  );
}
