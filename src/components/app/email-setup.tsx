"use client";
import { Check, CircleAlert, Copy, Inbox, Loader2, Mail, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { regenerateForwardingAddressAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { isAcceptedArchiveName } from "@/lib/mailArchiveNames";

type Activity = {
  id: string;
  status: "skipped" | "ingested" | "verification" | "rejected";
  fromDomain: string | null;
  reason: string | null;
  createdAt: string;
  documentId: string | null;
  documentName: string | null;
  documentStatus: string | null;
};
type Status = {
  enabled: boolean;
  address: string | null;
  verification: { code: string | null; link: string | null; receivedAt: string | null } | null;
  lastReceivedAt: string | null;
  activity: Activity[];
};
type Import = {
  id: string;
  filename: string;
  status: "queued" | "scanning" | "done" | "failed";
  scanned: number;
  relevant: number;
  imported: number;
  duplicates: number;
  limitReached: boolean;
  failureReason: string | null;
  createdAt: string;
};

/** Paste into Gmail's search bar, then "Create filter" → "Forward it to". */
export const GMAIL_FILTER =
  'subject:(receipt OR "order confirmation" OR "your order" OR "order #" OR invoice OR "free trial" OR "trial ends" OR renewal OR "renews on" OR subscription OR ecredit OR "travel credit" OR "flight credit" OR warranty OR "return label" OR refund) -category:promotions -category:social';

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked: text is selectable */
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : label}
    </Button>
  );
}

type ForwardTab = "gmail" | "outlook" | "icloud" | "other";
type ImportTab = "gmail" | "outlook" | "apple" | "thunderbird";
const FORWARD_TABS: [ForwardTab, string][] = [["gmail", "Gmail"], ["outlook", "Outlook"], ["icloud", "iCloud"], ["other", "Other / by hand"]];
const IMPORT_TABS: [ImportTab, string][] = [["gmail", "Gmail"], ["outlook", "Outlook"], ["apple", "Apple Mail"], ["thunderbird", "Thunderbird"]];
const ICLOUD_WORDS = ["receipt", "order", "invoice", "trial", "renewal", "subscription", "credit", "warranty", "refund"];

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 p-1 bg-hover rounded-[10px] w-fit text-[13px]" role="tablist">
      {tabs.map(([t, label]) => (
        <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)} className={cn("px-3 h-7 rounded-[8px]", value === t ? "bg-surface shadow-sm font-medium" : "text-muted")}>
          {label}
        </button>
      ))}
    </div>
  );
}

const ext = { className: "underline", target: "_blank", rel: "noreferrer noopener" } as const;

function ImportSteps({ tab }: { tab: ImportTab }) {
  const cls = "space-y-2 text-[14px] list-decimal pl-5 marker:text-subtle";
  if (tab === "gmail")
    return (
      <ol className={cls}>
        <li>Open <a {...ext} href="https://takeout.google.com/">Google Takeout</a>, click <b>Deselect all</b>, then tick only <b>Mail</b>.</li>
        <li>Optional: under <b>All Mail data included</b>, choose just <b>Inbox</b> or a label like <b>Purchases</b> to keep the file small.</li>
        <li>Create the export. Google emails you a link, usually within an hour. Download the <b>.zip</b> and upload it here.</li>
      </ol>
    );
  if (tab === "outlook")
    return (
      <div className="space-y-3 text-[14px]">
        <div>
          <p className="font-medium">Outlook.com / Hotmail / Live</p>
          <ol className={cls}>
            <li>On a computer, open <a {...ext} href="https://outlook.live.com/mail/0/options/general/privacy">Outlook settings → General → Privacy and data</a>.</li>
            <li>Under <b>Export mailbox</b>, click <b>Export</b>. Microsoft prepares a <b>.pst</b> file (this can take a few days) and shows a download link on that page.</li>
            <li>Download it and upload it here.</li>
          </ol>
        </div>
        <div>
          <p className="font-medium">Outlook for Windows (classic)</p>
          <ol className={cls}>
            <li><b>File</b> → <b>Open &amp; Export</b> → <b>Import/Export</b> → <b>Export to a file</b> → <b>Outlook Data File (.pst)</b>.</li>
            <li>Pick <b>Inbox</b>, tick <b>Include subfolders</b>, finish, and upload the .pst here.</li>
          </ol>
        </div>
        <div>
          <p className="font-medium">Outlook for Mac</p>
          <ol className={cls}>
            <li><b>File</b> → <b>Export</b> (older versions: <b>Tools</b> → <b>Export</b>), choose <b>Mail</b>, and save.</li>
            <li>Upload the <b>.olm</b> file here.</li>
          </ol>
        </div>
      </div>
    );
  if (tab === "apple")
    return (
      <ol className={cls}>
        <li>In Mail on your Mac, select <b>Inbox</b> (or another mailbox) in the sidebar.</li>
        <li>Choose <b>Mailbox</b> → <b>Export Mailbox…</b> and save it, for example to your Desktop.</li>
        <li>Right-click the exported <b>Inbox.mbox</b> → <b>Compress</b>, then upload the <b>.zip</b> here.</li>
      </ol>
    );
  return (
    <ol className={cls}>
      <li>In Thunderbird, open <b>Help</b> → <b>Troubleshooting Information</b> → <b>Profile Folder</b> → <b>Open Folder</b>.</li>
      <li>Go into <b>ImapMail</b> (or <b>Mail</b>), then your account&apos;s folder.</li>
      <li>Upload the file named <b>INBOX</b> or <b>Inbox</b>, the one <em>without</em> “.msf”. To send several folders, zip them first.</li>
    </ol>
  );
}

const fmt = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function EmailSetup({ initialStatus, initialImports, connect }: { initialStatus: Status; initialImports: Import[]; connect?: React.ReactNode }) {
  const [status, setStatus] = useState(initialStatus);
  const [imports, setImports] = useState(initialImports);
  const [tab, setTab] = useState<ForwardTab>("gmail");
  const [importTab, setImportTab] = useState<ImportTab>("gmail");
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ pct: number; name: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const importActive = imports.some((i) => i.status === "queued" || i.status === "scanning");

  // Poll: forwarding status (verification code, new mail) and import progress.
  useEffect(() => {
    if (!status.enabled && !importActive) return;
    let stop = false;
    const tick = async () => {
      try {
        const [s, i] = await Promise.all([status.enabled ? fetch("/api/email/status").then((r) => r.json()) : null, fetch("/api/imports").then((r) => r.json())]);
        if (stop) return;
        if (s?.address !== undefined) setStatus(s);
        if (Array.isArray(i?.imports)) setImports(i.imports);
      } catch {
        /* next tick */
      }
    };
    const t = setInterval(tick, importActive ? 3000 : 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [status.enabled, importActive]);

  function uploadMailbox(file: File) {
    setUploadError(null);
    if (!isAcceptedArchiveName(file.name)) {
      setUploadError("Choose a mail export: .zip, .mbox, .pst, or .olm.");
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/imports");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && setUpload({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = async () => {
      setUpload(null);
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 400 || !body.id) {
        setUploadError(body.error && body.error !== "internal_error" ? body.error : "Upload failed. Try again.");
        return;
      }
      const i = await fetch("/api/imports").then((r) => r.json()).catch(() => null);
      if (Array.isArray(i?.imports)) setImports(i.imports);
    };
    xhr.onerror = () => {
      setUpload(null);
      setUploadError("Upload failed. Check your connection and try again.");
    };
    setUpload({ name: file.name, pct: 0 });
    xhr.send(file);
  }

  const importSection = (
      <section>
        <SectionTitle>Bring in past emails</SectionTitle>
        <Card className="p-5 space-y-4">
          <p className="text-[14px]">Find old receipts, subscriptions, and credits you&apos;ve forgotten about, using a one-time export from your mail app.</p>
          <Tabs tabs={IMPORT_TABS} value={importTab} onChange={setImportTab} />
          <ImportSteps tab={importTab} />
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMailbox(f);
              e.target.value = "";
            }}
          />
          {upload ? (
            <div className="space-y-2">
              <p className="text-[13.5px] text-muted">Uploading {upload.name}… {upload.pct}%</p>
              <div className="h-1.5 rounded-full bg-hover overflow-hidden"><div className="h-full bg-ink transition-all" style={{ width: `${upload.pct}%` }} /></div>
            </div>
          ) : (
            <Button onClick={() => fileInput.current?.click()} disabled={importActive} variant="secondary">
              <Upload className="size-4" /> Upload mail export
            </Button>
          )}
          {uploadError ? <p className="text-[13.5px] text-urgent">{uploadError}</p> : null}

          {imports.length ? (
            <div className="divide-y divide-line border-t border-line pt-1" data-testid="imports">
              {imports.map((i) => (
                <div key={i.id} className="py-3 text-[13.5px]">
                  <div className="flex items-center gap-2">
                    {i.status === "queued" || i.status === "scanning" ? <Loader2 className="size-3.5 animate-spin" /> : i.status === "done" ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5 text-urgent" />}
                    <span className="font-medium truncate">{i.filename}</span>
                  </div>
                  <p className="text-muted mt-1 pl-5">
                    {i.status === "queued" ? "Waiting to start…" : null}
                    {i.status === "scanning" ? `Scanning… ${i.scanned.toLocaleString()} emails checked, ${i.imported} added so far.` : null}
                    {i.status === "done"
                      ? `Checked ${i.scanned.toLocaleString()} emails · ${i.relevant} looked important · ${i.imported} added${i.duplicates ? ` · ${i.duplicates} already here` : ""}.`
                      : null}
                    {i.status === "failed" ? i.failureReason ?? "That import failed." : null}
                  </p>
                  {i.limitReached ? <p className="text-subtle pl-5 mt-0.5">Stopped at your document limit. The most important remaining emails can be forwarded by hand.</p> : null}
                  {i.status === "done" && i.imported ? (
                    <Link href="/home" className="pl-5 text-[13px] underline">See what we found</Link>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-[12.5px] text-subtle">Your export is scanned once and deleted right after. Only emails that look like receipts, orders, trials, bills, credits, or warranties are kept.</p>
        </Card>
      </section>
  );

  if (!status.enabled) {
    return (
      <div className="space-y-6">
        <Header />
        {connect}
        <Card className="p-5 flex gap-3">
          <CircleAlert className="size-5 text-muted shrink-0 mt-0.5" />
          <div className="text-[14px] text-muted">
            <p className="text-ink font-medium">A forwarding address isn&apos;t set up on this server yet.</p>
            <p className="mt-1">Until then, you can import past email below, or <Link className="underline" href="/add">upload</Link> screenshots, PDFs, or saved .eml emails.</p>
          </div>
        </Card>
        {importSection}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <Header />

      {connect}

      <section>
        <SectionTitle>Or use your private address</SectionTitle>
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <code className="text-[15px] font-medium break-all select-all" data-testid="forwarding-address">{status.address}</code>
            <CopyButton text={status.address ?? ""} />
          </div>
          <p className="text-[13px] text-muted">
            Anything sent here is read by LIFEOS. Obvious newsletters and promotions are ignored automatically.{" "}
            {status.lastReceivedAt ? `Last email received ${fmt(status.lastReceivedAt)}.` : "No email received yet."}
          </p>
          <button
            className="text-[12.5px] text-subtle hover:text-ink inline-flex items-center gap-1"
            disabled={pending}
            onClick={() => {
              if (!confirm("Create a new address? The current one will stop working immediately.")) return;
              startTransition(async () => {
                const r = await regenerateForwardingAddressAction();
                setNotice(r.ok ? r.message ?? null : r.error);
                const s = await fetch("/api/email/status").then((x) => x.json()).catch(() => null);
                if (s?.address !== undefined) setStatus(s);
              });
            }}
          >
            <RefreshCw className="size-3" /> Get a new address
          </button>
          {notice ? <p className="text-[13px] text-muted">{notice}</p> : null}
        </Card>
      </section>

      {status.verification ? (
        <section>
          <Card className="p-5 border-ink/20 bg-hover/40" data-testid="gmail-verification">
            <p className="font-medium text-[15px]">Gmail sent a confirmation code</p>
            <p className="text-[13.5px] text-muted mt-1">Enter it in Gmail → Settings → Forwarding to finish turning on forwarding.</p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              {status.verification.code ? <code className="text-[22px] font-semibold tracking-wider">{status.verification.code}</code> : null}
              {status.verification.code ? <CopyButton text={status.verification.code} label="Copy code" /> : null}
              {status.verification.link ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={status.verification.link} target="_blank" rel="noreferrer noopener">Or confirm in Gmail</a>
                </Button>
              ) : null}
            </div>
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle>Forward new emails automatically</SectionTitle>
        <Card className="p-5 space-y-4">
          <Tabs tabs={FORWARD_TABS} value={tab} onChange={setTab} />

          {tab === "gmail" ? (
            <ol className="space-y-3 text-[14px] list-decimal pl-5 marker:text-subtle">
              <li>
                On a computer, open Gmail → <b>Settings</b> (gear) → <b>See all settings</b> → <b>Forwarding and POP/IMAP</b> → <b>Add a forwarding address</b>. Paste your address above.
              </li>
              <li>Gmail sends a confirmation code. It will appear on this page within a few seconds — copy it back into Gmail and click <b>Verify</b>.</li>
              <li>
                Leave forwarding <b>disabled</b> at the top of that page (so only matching mail is forwarded). Then paste this into the Gmail search bar and press Enter:
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                  <code className="block text-[12px] bg-hover rounded-lg p-3 break-words select-all flex-1" data-testid="gmail-filter">{GMAIL_FILTER}</code>
                  <CopyButton text={GMAIL_FILTER} />
                </div>
              </li>
              <li>
                Click the <b>sliders icon</b> in the search bar → <b>Create filter</b> → tick <b>Forward it to</b>, choose your LIFEOS address → <b>Create filter</b>.
              </li>
            </ol>
          ) : tab === "outlook" ? (
            <ol className="space-y-3 text-[14px] list-decimal pl-5 marker:text-subtle">
              <li>In Outlook on the web, open <b>Settings</b> → <b>Mail</b> → <b>Rules</b> → <b>Add new rule</b>.</li>
              <li>Condition: <b>Subject includes</b> — add: receipt, order confirmation, your order, invoice, free trial, renewal, subscription, travel credit, warranty, refund.</li>
              <li>Action: <b>Forward to</b> → paste your LIFEOS address. Save.</li>
              <li className="text-muted">Some work or school accounts block forwarding to outside addresses. If so, forward emails by hand.</li>
            </ol>
          ) : tab === "icloud" ? (
            <ol className="space-y-3 text-[14px] list-decimal pl-5 marker:text-subtle">
              <li>On a computer, open <a {...ext} href="https://www.icloud.com/mail/">iCloud Mail</a> → the <b>gear</b> icon → <b>Settings</b> → <b>Rules</b> → <b>Add a Rule</b>.</li>
              <li>Choose <b>If a message: subject contains</b> and type a word like <b>receipt</b>. Then <b>Forward to</b> → paste your LIFEOS address. Save.</li>
              <li>
                iCloud allows one word per rule, so add a rule for each word you care about:{" "}
                <span className="text-muted">{ICLOUD_WORDS.join(", ")}</span>.
              </li>
              <li className="text-muted">Tip: “order” and “receipt” catch most purchases. Rules work on mail sent to your @icloud.com, @me.com, and @mac.com addresses.</li>
            </ol>
          ) : (
            <p className="text-[14px]">
              Forward any receipt, order, trial, or credit email to your address from any mail app. Tip: save it as a contact named &quot;LIFEOS&quot; so it&apos;s one tap away.
            </p>
          )}
          <p className="text-[12.5px] text-subtle">
            LIFEOS never logs into your inbox. It only sees emails you (or your rule) forward, and it ignores anything that doesn&apos;t look like a receipt, order, trial, bill, credit, or warranty.
          </p>
        </Card>
      </section>

      {importSection}

      <section>
        <SectionTitle count={status.activity.length}>Recent forwarded email</SectionTitle>
        <Card className="divide-y divide-line">
          {status.activity.length === 0 ? <p className="p-5 text-[14px] text-muted">Nothing yet. Forward an email to try it.</p> : null}
          {status.activity.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] truncate">
                  {a.status === "verification" ? "Gmail confirmation code" : a.documentName?.replace(/\.eml$/, "") ?? a.fromDomain ?? "Email"}
                </p>
                <p className="text-[12.5px] text-subtle">
                  {fmt(a.createdAt)} · {a.fromDomain ?? "unknown sender"} ·{" "}
                  {a.status === "ingested" ? "Added" : a.status === "skipped" ? "Ignored (looked like marketing)" : a.status === "rejected" ? (a.reason === "limit_reached" ? "Not added — document limit reached" : "Not added") : "Captured"}
                </p>
              </div>
              {a.status === "ingested" && a.documentId ? (
                <Link href="/documents" className="text-[13px] text-muted hover:text-ink shrink-0">View</Link>
              ) : null}
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-start gap-3">
      <span className="size-12 rounded-2xl bg-grape text-ink grid place-items-center shrink-0 rotate-[-6deg]"><Mail className="size-6" /></span>
      <div>
        <h1 className="display-2 text-[36px] sm:text-[44px]">Email</h1>
        <p className="text-muted text-[14px] mt-1 flex items-center gap-1.5"><Inbox className="size-3.5" /> Send receipts and subscription emails to LIFEOS automatically.</p>
      </div>
    </div>
  );
}
