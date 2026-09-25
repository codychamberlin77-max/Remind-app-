"use client";
import { ArrowRight, Camera, Check, CircleAlert, Eye, FileUp, Info, Loader2, Pencil, Plane, ReceiptText, Tv } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { confirmFactAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CertaintyBadge } from "@/components/ui/certainty";
import { cn } from "@/lib/cn";
import type { Certainty } from "@/server/domain/types";
import { EditFact } from "./edit-fact";
import { ReminderPicker } from "./reminder-picker";

type Discovery = {
  itemId: string;
  kind: string;
  label: string;
  value: string;
  detail: string | null;
  certainty: Certainty | null;
  factKey: string | null;
  actionId: string | null;
  documentId?: string | null;
  raw?: { valueDate: string | null; valueCents: number | null; valueText: string | null } | null;
};
type DocState = { id: string | null; filename: string; stage: string; status: string; error?: string | null };

const STAGES = ["received", "reading", "classifying", "extracting", "verifying", "checking_policies", "finding_actions", "done"] as const;
const STAGE_TEXT: Record<string, string> = {
  received: "Uploading securely…",
  reading: "Reading your document…",
  classifying: "Figuring out what this is…",
  extracting: "Pulling out dates, amounts, and policies…",
  verifying: "Checking every detail against the document…",
  checking_policies: "Checking return windows and warranties…",
  finding_actions: "Finding what needs your attention…",
  done: "Done",
};
const TERMINAL = new Set(["processed", "needs_review", "failed", "unsupported"]);
const MIN_STAGE_MS = 420;

const SAMPLES = [
  { id: "receipt", title: "Electronics receipt", sub: "Best Buy · Samsung TV", icon: Tv },
  { id: "trial", title: "Free-trial email", sub: "Streaming subscription", icon: ReceiptText },
  { id: "credit", title: "Airline credit", sub: "Delta eCredit", icon: Plane },
] as const;

export function UploadFlow({ welcome }: { welcome: boolean }) {
  const [phase, setPhase] = useState<"idle" | "working" | "reveal">("idle");
  const [docs, setDocs] = useState<DocState[]>([]);
  const [shownStage, setShownStage] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ found: Discovery[]; unknowns: Discovery[]; failures: DocState[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const start = useCallback(async (upload: () => Promise<DocState[]>) => {
    setTopError(null);
    setUploaded(false);
    setPhase("working");
    setShownStage({});
    try {
      const initial = await upload();
      setDocs(initial);
      setUploaded(true);
      if (!initial.some((d) => d.id)) {
        setResult({ found: [], unknowns: [], failures: initial });
        setPhase("reveal");
      }
    } catch {
      setTopError("Upload failed. Check your connection and try again.");
      setPhase("idle");
    }
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 10);
    if (!list.length) return;
    await start(async () => {
      setDocs(list.map((f) => ({ id: null, filename: f.name, stage: "received", status: "queued" })));
      const fd = new FormData();
      list.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "upload failed");
      const { results } = (await res.json()) as { results: Array<{ filename: string; status: string; documentId?: string; message?: string }> };
      return results.map((r) =>
        r.status === "rejected"
          ? { id: null, filename: r.filename, stage: "failed", status: "failed", error: r.message }
          : { id: r.documentId!, filename: r.filename, stage: r.status === "duplicate" ? "done" : "received", status: r.status === "duplicate" ? "processed" : "queued" },
      );
    });
  }

  async function trySample(id: string, title: string) {
    await start(async () => {
      setDocs([{ id: null, filename: title, stage: "received", status: "queued" }]);
      const res = await fetch("/api/samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) throw new Error("sample failed");
      const { result } = (await res.json()) as { result: { status: string; documentId?: string; message?: string } };
      return [
        result.documentId
          ? { id: result.documentId, filename: title, stage: result.status === "duplicate" ? "done" : "received", status: result.status === "duplicate" ? "processed" : "queued" }
          : { id: null, filename: title, stage: "failed", status: "failed", error: result.message },
      ];
    });
  }

  // Poll real pipeline progress.
  useEffect(() => {
    if (phase !== "working") return;
    const ids = docs.map((d) => d.id).filter(Boolean) as string[];
    if (!ids.length) return;
    if (docs.every((d) => !d.id || TERMINAL.has(d.status))) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/documents/status?ids=${ids.join(",")}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return setDocs((d) => [...d]);
      const { documents } = (await res.json()) as { documents: Array<{ id: string; status: string; stage: string; failureReason: string | null }> };
      setDocs((prev) => prev.map((d) => {
        const u = documents.find((x) => x.id === d.id);
        return u ? { ...d, status: u.status, stage: u.stage, error: u.failureReason } : d;
      }));
    }, 600);
    return () => clearTimeout(t);
  }, [phase, docs]);

  // Advance the visible stage one step at a time, so progress is legible even when fast.
  useEffect(() => {
    if (phase !== "working") return;
    const t = setTimeout(() => {
      setShownStage((prev) => {
        const next = { ...prev };
        docs.forEach((d, i) => {
          const key = d.id ?? `pending-${i}`;
          const target = d.status === "failed" || d.status === "unsupported" ? STAGES.length - 1 : Math.max(0, STAGES.indexOf(d.stage as (typeof STAGES)[number]));
          const cur = prev[key] ?? 0;
          if (cur < target) next[key] = cur + 1;
        });
        return next;
      });
    }, MIN_STAGE_MS);
    return () => clearTimeout(t);
  }, [phase, docs, shownStage]);

  // When everything is finished and the visible progress has caught up → reveal.
  useEffect(() => {
    if (phase !== "working" || !uploaded || !docs.length) return;
    const finished = docs.every((d) => !d.id || TERMINAL.has(d.status));
    const caughtUp = docs.every((d, i) => !d.id || !TERMINAL.has(d.status) || d.status === "failed" || d.status === "unsupported" || (shownStage[d.id ?? `pending-${i}`] ?? 0) >= STAGES.length - 1);
    if (!finished || !caughtUp) return;
    const ids = docs.filter((d) => d.id && d.status !== "failed" && d.status !== "unsupported").map((d) => d.id!) ;
    const failures = docs.filter((d) => !d.id || d.status === "failed" || d.status === "unsupported" || (d.status === "needs_review" && d.error));
    (async () => {
      const r = ids.length ? await fetch(`/api/discoveries?ids=${ids.join(",")}`, { cache: "no-store" }).then((x) => x.json()) : { found: [], unknowns: [] };
      setResult({ found: r.found ?? [], unknowns: r.unknowns ?? [], failures });
      setPhase("reveal");
    })();
  }, [phase, uploaded, docs, shownStage]);

  if (phase === "reveal" && result) {
    return <Reveal result={result} onAnother={() => { setPhase("idle"); setDocs([]); setResult(null); }} />;
  }

  if (phase === "working") {
    return (
      <div className="animate-fade">
        <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-[-0.025em]">Looking through {docs.length > 1 ? `${docs.length} documents` : "your document"}…</h1>
        <p className="text-muted mt-2">This usually takes a few seconds.</p>
        <div className="mt-8 space-y-3">
          {docs.map((d, i) => {
            const idx = shownStage[d.id ?? `pending-${i}`] ?? 0;
            const failed = d.status === "failed" || d.status === "unsupported";
            const pct = failed ? 100 : Math.round(((idx + 1) / STAGES.length) * 100);
            return (
              <Card key={i} className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-[15px] truncate">{d.filename}</p>
                  {failed ? <CircleAlert className="size-4 text-urgent shrink-0" /> : idx >= STAGES.length - 1 ? <Check className="size-4 text-confirmed shrink-0" /> : <Loader2 className="size-4 text-subtle animate-spin shrink-0" />}
                </div>
                <p className={cn("text-[14px] mt-1", failed ? "text-urgent" : "text-muted")}>{failed ? d.error ?? "We couldn't read this file." : STAGE_TEXT[STAGES[idx]!]}</p>
                <div className="mt-4 h-1 rounded-full bg-hover overflow-hidden">
                  <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", failed ? "bg-urgent" : "bg-ink")} style={{ width: `${pct}%` }} />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em] leading-tight">
        {welcome ? "Let's find what you're forgetting." : "Add something new."}
      </h1>
      <p className="text-muted mt-2.5 text-[16px]">Upload a receipt, document, screenshot, or PDF.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadFiles(e.dataTransfer.files); }}
        className={cn(
          "mt-8 rounded-[22px] border-[1.5px] border-dashed px-6 py-12 sm:py-16 text-center transition-colors",
          dragging ? "border-ink bg-surface" : "border-line-strong bg-surface/60",
        )}
      >
        <span className="mx-auto grid place-items-center size-12 rounded-2xl bg-canvas shadow-[var(--shadow-card)]">
          <FileUp className="size-5 text-ink-2" />
        </span>
        <p className="mt-5 font-medium text-[16px]">Drop files here</p>
        <p className="text-[13.5px] text-subtle mt-1">PDF, JPG, PNG, WebP, screenshots, or saved emails (.eml) · up to 20 MB</p>
        <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
          <Button size="lg" onClick={() => fileInput.current?.click()}>Choose files</Button>
          <Button size="lg" variant="secondary" className="sm:hidden" onClick={() => cameraInput.current?.click()}>
            <Camera className="size-4" /> Take a photo
          </Button>
        </div>
        <input ref={fileInput} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.eml,.txt,application/pdf,image/*,message/rfc822,text/plain" onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        <input ref={cameraInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
      </div>
      {topError ? <p className="mt-3 text-[14px] text-urgent">{topError}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {["Your last online order", "A free-trial email", "An airline credit", "A warranty card", "A bill"].map((s) => (
          <span key={s} className="h-8 px-3 inline-flex items-center rounded-full bg-surface shadow-[var(--shadow-card)] text-[13px] text-muted">{s}</span>
        ))}
      </div>

      <div className="mt-12">
        <p className="text-[13px] font-semibold text-ink-2 px-1">No file handy? Try a sample.</p>
        <p className="text-[13px] text-subtle px-1 mt-0.5">Samples are processed on our servers only. Nothing is sent to an AI provider.</p>
        <div className="mt-3 grid sm:grid-cols-3 gap-2.5">
          {SAMPLES.map((s) => (
            <button key={s.id} onClick={() => trySample(s.id, s.title)} className="group text-left p-4 rounded-2xl bg-surface shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-pop)] transition-shadow">
              <s.icon className="size-4 text-muted" />
              <p className="mt-3 text-[14px] font-medium">{s.title}</p>
              <p className="text-[12.5px] text-subtle">{s.sub}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Reveal({ result, onAnother }: { result: { found: Discovery[]; unknowns: Discovery[]; failures: DocState[] }; onAnother: () => void }) {
  const n = result.found.filter((d) => d.kind !== "document").length;
  const onlyDocs = n === 0 && result.found.length > 0;
  return (
    <div>
      <div className="animate-rise">
        {n > 0 ? (
          <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em] leading-tight">
            We found {n} {n === 1 ? "thing" : "things"} worth knowing.
          </h1>
        ) : onlyDocs ? (
          <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-[-0.025em]">Saved. No deadlines in this one.</h1>
        ) : (
          <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-[-0.025em]">We couldn&apos;t read that.</h1>
        )}
        {n > 0 ? <p className="text-muted mt-2">Check anything marked estimated. You can correct any detail.</p> : null}
      </div>

      <div className="mt-8 space-y-3">
        {result.found.map((d, i) => (
          <DiscoveryCard key={`${d.itemId}-${d.label}-${i}`} d={d} delay={120 + i * 110} />
        ))}
      </div>

      {result.unknowns.length ? (
        <div className="mt-8 animate-rise" style={{ animationDelay: `${200 + result.found.length * 110}ms` }}>
          <p className="text-[13px] font-semibold text-ink-2 px-1 mb-2.5">What we couldn&apos;t find</p>
          <div className="space-y-2.5">
            {result.unknowns.map((d, i) => (
              <Card key={i} className="p-4 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium">{d.label}</p>
                    <CertaintyBadge certainty="unknown" />
                  </div>
                  {d.detail ? <p className="text-[13.5px] text-muted mt-1.5 leading-relaxed">{d.detail}</p> : null}
                </div>
                {d.factKey ? (
                  <EditFact itemId={d.itemId} factKey={d.factKey} label={d.label} current={{}} trigger={<Button size="sm" variant="secondary">Add it</Button>} />
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {result.failures.length ? (
        <div className="mt-6 space-y-2">
          {result.failures.map((f, i) => (
            <p key={i} className="text-[13.5px] text-muted flex items-center gap-2">
              <CircleAlert className="size-4 text-urgent shrink-0" /> <span className="font-medium text-ink-2">{f.filename}:</span> {f.error ?? "We couldn't process this file."}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-10 flex flex-col sm:flex-row gap-2.5 animate-fade" style={{ animationDelay: `${400 + result.found.length * 110}ms` }}>
        <Button asChild size="lg">
          <Link href="/home">Go to my dashboard <ArrowRight className="size-4" /></Link>
        </Button>
        <Button size="lg" variant="secondary" onClick={onAnother}>Add another</Button>
      </div>
    </div>
  );
}

function DiscoveryCard({ d, delay }: { d: Discovery; delay: number }) {
  const [certainty, setCertainty] = useState(d.certainty);
  const [confirmedNote, setConfirmedNote] = useState(false);
  const [pending, start] = useTransition();

  if (d.kind === "money") {
    return (
      <Card className="p-5 animate-rise bg-confirmed-bg/60" style={{ animationDelay: `${delay}ms` }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] text-confirmed font-medium">{d.label}</p>
            <p className="text-[12.5px] text-muted mt-1 max-w-sm leading-relaxed flex gap-1.5"><Info className="size-3.5 mt-0.5 shrink-0" />{d.detail}</p>
          </div>
          <p className="text-[26px] font-semibold tracking-[-0.02em] text-money tabular">{d.value}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 animate-rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted">{d.label}</p>
          <p className="text-[19px] font-semibold tracking-[-0.015em] mt-0.5 tabular">{d.value}</p>
        </div>
        {certainty ? <CertaintyBadge certainty={certainty} className="shrink-0 mt-0.5" /> : null}
      </div>
      {d.detail ? <p className="text-[14px] text-ink-2/80 mt-2.5 leading-relaxed">{confirmedNote ? "You confirmed this." : d.detail}</p> : null}
      {d.factKey || d.actionId || d.documentId ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {d.factKey && certainty && certainty !== "unknown" && !confirmedNote ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => start(async () => {
                const r = await confirmFactAction(d.itemId, d.factKey!);
                if (r.ok) { setCertainty("confirmed"); setConfirmedNote(true); }
              })}
            >
              <Check className="size-3.5" /> Looks right
            </Button>
          ) : null}
          {d.factKey ? (
            <EditFact itemId={d.itemId} factKey={d.factKey} label={d.label} current={d.raw ?? {}} trigger={<Button size="sm" variant="secondary"><Pencil className="size-3.5" /> Edit</Button>} />
          ) : null}
          {d.actionId ? <ReminderPicker actionId={d.actionId} itemId={d.itemId} dueOn={d.raw?.valueDate ?? null} label="Set reminder" /> : null}
          {d.documentId ? (
            <Button asChild size="sm" variant="ghost">
              <a href={`/api/documents/${d.documentId}/file`} target="_blank" rel="noopener"><Eye className="size-3.5" /> View source</a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
