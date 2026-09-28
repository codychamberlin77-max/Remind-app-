"use client";
import { CircleAlert, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { disconnectInboxAction, syncInboxNowAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

type Connection = {
  id: string;
  provider: "gmail" | "outlook";
  emailAddress: string;
  status: "active" | "revoked" | "error";
  lastError: string | null;
  lastSyncedAt: string | null;
  imported: number;
};

const LABEL = { gmail: "Gmail", outlook: "Outlook" } as const;
const ERRORS: Record<string, string> = {
  denied: "No problem — nothing was connected.",
  expired: "That took too long or came from another session. Please try again.",
  no_offline_access: "We didn't get ongoing access. Please try again and allow access.",
  unavailable: "That connection isn't available yet.",
  failed: "Something went wrong connecting your inbox. Please try again.",
};

function GmailMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d="M3 6.5 12 13l9-6.5V18a1.5 1.5 0 0 1-1.5 1.5H17V10l-5 3.6L7 10v9.5H4.5A1.5 1.5 0 0 1 3 18z" fill="#EA4335" />
      <path d="M3 6.5V6a2 2 0 0 1 3.2-1.6L12 8.6l5.8-4.2A2 2 0 0 1 21 6v.5L12 13z" fill="#FBBC04" />
    </svg>
  );
}
function OutlookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect x="3" y="5" width="12" height="14" rx="2" fill="#0A64C9" />
      <path d="M13 8h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7z" fill="#28A8EA" />
      <circle cx="9" cy="12" r="3" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

export function InboxConnections({
  connections,
  available,
  justConnected,
  connectError,
}: {
  connections: Connection[];
  available: { gmail: boolean; outlook: boolean };
  justConnected: string | null;
  connectError: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(justConnected ? `${LABEL[justConnected as "gmail"] ?? "Inbox"} connected. We're checking it for receipts now.` : null);

  // Right after connecting, refresh a few times so the first results appear.
  useEffect(() => {
    if (!justConnected) return;
    let n = 0;
    const t = setInterval(() => (++n > 12 ? clearInterval(t) : router.refresh()), 5000);
    return () => clearInterval(t);
  }, [justConnected, router]);

  const fmt = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const anyAvailable = available.gmail || available.outlook;

  return (
    <section>
      <SectionTitle>Connect your inbox</SectionTitle>
      <Card className="p-5 space-y-4">
        <p className="text-[14.5px]">
          The easiest way. Sign in once and new receipts, orders, trials and bills show up here on their own. No address, no filters.
        </p>

        {connectError ? (
          <p className="flex gap-2 text-[13.5px] text-urgent"><CircleAlert className="size-4 mt-0.5 shrink-0" />{ERRORS[connectError] ?? ERRORS.failed}</p>
        ) : null}
        {notice ? <p className="text-[13.5px] text-leaf font-medium">{notice}</p> : null}

        {connections.length ? (
          <div className="divide-y divide-line rounded-2xl bg-surface">
            {connections.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  {c.provider === "gmail" ? <GmailMark /> : <OutlookMark />}
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium truncate">{c.emailAddress}</p>
                    <p className={cn("text-[12.5px]", c.status === "error" ? "text-urgent" : "text-subtle")}>
                      {c.status === "error"
                        ? "Access expired — reconnect to keep syncing."
                        : c.lastSyncedAt
                          ? `Checked ${fmt(c.lastSyncedAt)} · ${c.imported} added`
                          : "First check in progress…"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {c.status === "error" ? (
                    <Button asChild size="sm"><a href={`/api/connections/${c.provider}/start`}>Reconnect</a></Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => start(async () => { const r = await syncInboxNowAction(c.id); setNotice(r.ok ? r.message ?? null : r.error); setTimeout(() => router.refresh(), 6000); })}
                    >
                      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check now
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`Disconnect ${c.emailAddress}? We'll delete our access. Things already added stay.`)) return;
                      start(async () => { const r = await disconnectInboxAction(c.id); setNotice(r.ok ? r.message ?? null : r.error); router.refresh(); });
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {anyAvailable ? (
          <div className="flex flex-col sm:flex-row gap-2.5">
            {available.gmail ? (
              <Button asChild size="lg" variant="secondary" className="bg-surface hover:bg-hover">
                <a href="/api/connections/gmail/start"><GmailMark /> Connect Gmail</a>
              </Button>
            ) : null}
            {available.outlook ? (
              <Button asChild size="lg" variant="secondary" className="bg-surface hover:bg-hover">
                <a href="/api/connections/outlook/start"><OutlookMark /> Connect Outlook</a>
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-[13.5px] text-muted">Direct Gmail and Outlook connections are coming soon. Until then, use your forwarding address below.</p>
        )}

        <p className="flex gap-2 text-[12.5px] text-subtle">
          <ShieldCheck className="size-4 shrink-0 text-leaf" />
          <span>Read-only. We only open emails that look like receipts, orders, trials, bills or warranties, and we never send, delete or change anything. Disconnect anytime. <a href="/privacy#s4" className="underline">How we handle your email</a></span>
        </p>
      </Card>
    </section>
  );
}
