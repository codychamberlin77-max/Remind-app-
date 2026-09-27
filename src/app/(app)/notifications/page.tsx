import { BellRing } from "lucide-react";
import Link from "next/link";
import { MarkRead } from "@/components/app/mark-read";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { getPreferences, listInbox } from "@/server/services/reminders";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Notifications() {
  const user = await requireUser();
  const [items, prefs] = await Promise.all([listInbox(user.id), getPreferences(user.id)]);
  const unreadIds = items.filter((n) => !n.readAt).map((n) => n.id);
  const fmt = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: user.timezone });
  const schedule = prefs.autoReminders && prefs.autoOffsets.length
    ? prefs.autoOffsets.map((o) => (o === 0 ? "on the day" : o === 7 ? "1 week" : `${o} days`)).join(", ").replace(/, ([^,]*)$/, " and $1")
    : null;

  return (
    <div className="space-y-8">
      <MarkRead ids={unreadIds} />
      <div>
        <h1 className="display-2 text-[36px] sm:text-[44px]">Notifications</h1>
        <p className="text-muted text-[14.5px] mt-2">
          {schedule ? <>We remind you {schedule} before each deadline. </> : <>Automatic reminders are off. </>}
          <Link href="/settings" className="underline">Change</Link>
        </p>
      </div>
      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <span className="mx-auto grid place-items-center size-12 rounded-2xl bg-sun text-ink rotate-[-6deg]"><BellRing className="size-6" /></span>
          <p className="mt-4 font-display text-[18px] font-semibold tracking-[-0.02em]">No reminders yet</p>
          <p className="text-[14px] text-muted mt-1">When a deadline gets close, it shows up here{prefs.emailEnabled ? " and in your email" : ""}.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {items.map((n) => (
            <Link key={n.id} href={n.itemId ? `/items/${n.itemId}` : "/home"} className="flex gap-3 px-4 py-4 hover:bg-hover transition-colors">
              <span className={`mt-1.5 size-2.5 rounded-full shrink-0 ${n.readAt ? "bg-transparent" : "bg-coral"}`} aria-hidden />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-[-0.01em]">{n.title}</span>
                <span className="block text-[13.5px] text-muted mt-0.5">{n.body}</span>
                <span className="block text-[12px] text-subtle mt-1">
                  {fmt(n.createdAt)}
                  {n.actionStatus === "done" ? " · Done" : ""}
                </span>
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
