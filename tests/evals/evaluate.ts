import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { registerMockRecordings, type MockRecording } from "@/server/ai/providers/mock";
import { setClock } from "@/server/clock";
import { db, schema, withUser } from "@/server/db/client";
import { ingest } from "@/server/ingestion/ingest";
import { CASES, EVAL_TODAY, type EvalCase, type Expected, type ExpectedFact, type OneOrMore } from "./cases";

const asList = <T,>(v: OneOrMore<T>): T[] => (Array.isArray(v) ? v : [v]);

const FIXTURES = path.resolve("tests/evals/fixtures");

export type CaseResult = {
  id: string;
  covers: string;
  documentType: string | null;
  classificationConfidence: number | null;
  actualItems: Array<{ kind: string; title: string; needsReview: boolean; facts: string[] }>;
  status: { expected: string; actual: string; ok: boolean; reason: string | null };
  facts: Array<{
    item: number;
    key: string;
    expected: ExpectedFact;
    actual: { certainty: string; valueDate: string | null; valueCents: number | null; confidence: number; basis: string; explanation: string | null } | null;
    ok: boolean;
  }>;
  warnings: string[];
  deadlines: { shown: Array<{ type: string; dueOn: string | null; certainty: string }>; falseDeadlines: string[]; missed: string[] };
  items: { expected: number; actual: number; ok: boolean; notes: string[] };
  evidence: { proposed: number; rejected: number };
  processingMs: number | null;
  tokens: { input: number; output: number };
};

export type EvalReport = {
  provider: string;
  today: string;
  cases: CaseResult[];
  metrics: {
    extractionAccuracy: number;
    factsCorrect: number;
    factsTotal: number;
    statusAccuracy: number;
    itemAccuracy: number;
    falseDeadlineRate: number;
    falseDeadlines: number;
    deadlinesShown: number;
    deadlineRecall: number;
    evidenceValidationRate: number;
    evidenceProposed: number;
    evidenceRejected: number;
    calibration: Array<{ bucket: string; n: number; accuracy: number | null; meanConfidence: number | null }>;
    expectedCalibrationError: number;
    processingMs: { p50: number; p95: number; max: number };
    tokens: { input: number; output: number };
  };
};

async function loadManifest(): Promise<Record<string, { file: string; sha256: string }>> {
  return JSON.parse(await readFile(path.join(FIXTURES, "manifest.json"), "utf8"));
}

export async function registerCaseRecordings() {
  const manifest = await loadManifest();
  const recs: MockRecording[] = CASES.filter((c) => c.recording).map((c) => ({
    id: `eval:${c.id}`,
    match: { sha256: manifest[c.id]!.sha256 },
    classify: c.recording!.classify as MockRecording["classify"],
    transcribe: c.recording!.transcribe as MockRecording["transcribe"],
    extract: c.recording!.extract,
  }));
  registerMockRecordings(recs);
}

/** Count non-null values the model proposed (objects shaped like {value, evidence}). */
function countProposed(x: unknown): number {
  if (!x || typeof x !== "object") return 0;
  if (Array.isArray(x)) return x.reduce((n, v) => n + countProposed(v), 0);
  const o = x as Record<string, unknown>;
  if ("value" in o && "evidence" in o) return o.value != null ? 1 : 0;
  if ("name" in o && "evidence" in o) return 1; // line item
  return Object.values(o).reduce<number>((n, v) => n + countProposed(v), 0);
}

const REJECTION = /^(ungrounded_|date_mismatch|implausible_|future_past_date|deadline_before_purchase)/;

async function runCase(c: EvalCase, manifest: Record<string, { file: string; sha256: string }>, provider: string): Promise<CaseResult> {
  const expected: Expected = provider === "mock" && c.mockExpected ? c.mockExpected : c.expected;
  const userId = uuidv7();
  await db().insert(schema.users).values({ id: userId, name: "Eval Runner", email: `eval-${userId}@example.com`, timezone: "America/New_York" });

  const upload = async (id: string) => {
    const m = manifest[id]!;
    const bytes = await readFile(path.join(FIXTURES, m.file));
    return ingest({ userId, plan: "pro", source: "upload", bytes, filename: m.file });
  };
  for (const req of c.requires ?? []) await upload(req);
  const res = await upload(c.id);

  const notes: string[] = [];
  let actualStatus: string = res.status === "rejected" ? "rejected" : "missing";
  let items: Array<typeof schema.items.$inferSelect> = [];
  let facts: Array<typeof schema.itemFacts.$inferSelect> = [];
  let actions: Array<typeof schema.actions.$inferSelect> = [];
  let proposed = 0;
  let rejected = 0;
  let processingMs: number | null = null;
  let documentType: string | null = null;
  let classificationConfidence: number | null = null;
  let failureReason: string | null = null;
  let warnings: string[] = [];
  const tokens = { input: 0, output: 0 };

  if (res.status === "accepted" || res.status === "duplicate") {
    const documentId = res.documentId;
    await withUser(userId, async (tx) => {
      const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId));
      actualStatus = doc!.status;
      processingMs = doc!.processingMs;
      failureReason = doc!.failureReason;
      items = await tx.select().from(schema.items).where(and(eq(schema.items.userId, userId), eq(schema.items.documentId, documentId))).orderBy(schema.items.createdAt);
      if (items.length) {
        const ids = items.map((i) => i.id);
        facts = await tx.select().from(schema.itemFacts).where(inArray(schema.itemFacts.itemId, ids));
        actions = await tx.select().from(schema.actions).where(inArray(schema.actions.itemId, ids));
      }
      const [ex] = await tx.select().from(schema.documentExtractions).where(eq(schema.documentExtractions.documentId, documentId));
      if (ex) {
        documentType = ex.documentType;
        classificationConfidence = ex.classificationConfidence;
        warnings = ex.warnings;
        proposed = countProposed(ex.rawOutput);
        rejected = ex.warnings.filter((w) => REJECTION.test(w)).length;
        tokens.input = ex.inputTokens ?? 0;
        tokens.output = ex.outputTokens ?? 0;
      }
    });
  } else if (res.status === "rejected") {
    notes.push(`rejected: ${res.code}`);
  }

  // Items: match expected → actual in order by kind (+ title).
  const used = new Set<string>();
  const matched = expected.items.map((e) => {
    const hit = items.find((i) => !used.has(i.id) && i.kind === e.kind && (!e.titleIncludes || i.title.toLowerCase().includes(e.titleIncludes.toLowerCase())));
    if (hit) used.add(hit.id);
    else notes.push(`missing item ${e.kind}${e.titleIncludes ? ` "${e.titleIncludes}"` : ""}`);
    if (hit && e.duplicate !== undefined && !!hit.possibleDuplicateOf !== e.duplicate) notes.push(`duplicate flag expected ${e.duplicate}`);
    if (hit && e.conflict !== undefined && !!hit.conflictNote !== e.conflict) notes.push(`conflict flag expected ${e.conflict}`);
    return hit;
  });
  const itemsOk = matched.every(Boolean) && items.length === expected.items.length && !notes.some((n) => n.startsWith("duplicate") || n.startsWith("conflict"));

  const factResults: CaseResult["facts"] = [];
  expected.items.forEach((e, idx) => {
    const item = matched[idx];
    for (const [key, exp] of Object.entries(e.facts ?? {})) {
      const f = item ? facts.find((x) => x.itemId === item.id && x.key === key) : undefined;
      const actual = f ? { certainty: f.certainty, valueDate: f.valueDate, valueCents: f.valueCents, confidence: f.confidence, basis: f.basis, explanation: f.explanation } : null;
      const certainty = (actual?.certainty ?? "unknown") as never;
      const ok =
        asList(exp.certainty).includes(certainty) &&
        (exp.valueDate === undefined || actual?.valueDate === exp.valueDate) &&
        (exp.valueCents === undefined || actual?.valueCents === exp.valueCents);
      factResults.push({ item: idx, key, expected: exp, actual, ok });
    }
  });

  const RANK = { confirmed: 2, estimated: 1, unknown: 0 } as const;
  const shown = actions.filter((a) => a.dueOn).map((a) => ({ type: a.type, dueOn: a.dueOn, certainty: a.dueCertainty }));
  const falseDeadlines: string[] = [];
  for (const s of shown) {
    const exp = expected.deadlines.find((d) => d.type === s.type && d.dueOn === s.dueOn);
    if (!exp) falseDeadlines.push(`${s.type} ${s.dueOn} (${s.certainty}) is not a correct deadline`);
    else if (RANK[s.certainty] > Math.max(...asList(exp.certainty).map((x) => RANK[x]))) {
      falseDeadlines.push(`${s.type} ${s.dueOn} shown as ${s.certainty}, should be ${asList(exp.certainty).join(" or ")}`);
    }
  }
  const missed = expected.deadlines.filter((d) => !shown.some((s) => s.type === d.type && s.dueOn === d.dueOn)).map((d) => `${d.type} ${d.dueOn}`);

  return {
    id: c.id,
    covers: c.covers,
    documentType,
    classificationConfidence,
    actualItems: items.map((i) => ({
      kind: i.kind,
      title: i.title,
      needsReview: i.needsReview,
      facts: facts
        .filter((f) => f.itemId === i.id)
        .map((f) => `${f.key}=${f.certainty}${f.valueDate ? `:${f.valueDate}` : f.valueCents != null ? `:${f.valueCents}` : ""}(${f.basis},${f.confidence})`),
    })),
    status: { expected: asList(expected.status).join(" or "), actual: actualStatus, ok: (asList(expected.status) as string[]).includes(actualStatus), reason: failureReason },
    warnings,
    facts: factResults,
    deadlines: { shown, falseDeadlines, missed },
    items: { expected: expected.items.length, actual: items.length, ok: itemsOk, notes },
    evidence: { proposed, rejected },
    processingMs,
    tokens,
  };
}

function pct(n: number, d: number) {
  return d === 0 ? 1 : Math.round((n / d) * 10000) / 10000;
}

export async function runEval(opts: { provider: string; only?: string[]; onCase?: (r: CaseResult, i: number, n: number) => void }): Promise<EvalReport> {
  setClock(new Date(`${EVAL_TODAY}T16:00:00Z`));
  try {
    if (opts.provider === "mock") await registerCaseRecordings();
    const manifest = await loadManifest();
    const cases = CASES.filter((c) => !opts.only?.length || opts.only.includes(c.id));
    const results: CaseResult[] = [];
    for (const [i, c] of cases.entries()) {
      const r = await runCase(c, manifest, opts.provider);
      results.push(r);
      opts.onCase?.(r, i + 1, cases.length);
    }

    const facts = results.flatMap((r) => r.facts);
    const shown = results.flatMap((r) => r.deadlines.shown);
    const falseDl = results.flatMap((r) => r.deadlines.falseDeadlines);
    const expectedDl = cases.reduce((n, c) => n + (opts.provider === "mock" && c.mockExpected ? c.mockExpected : c.expected).deadlines.length, 0);
    const missed = results.reduce((n, r) => n + r.deadlines.missed.length, 0);
    const proposed = results.reduce((n, r) => n + r.evidence.proposed, 0);
    const rejected = results.reduce((n, r) => n + r.evidence.rejected, 0);

    // Calibration over facts we displayed with a value (not unknown).
    const withValue = facts.filter((f) => f.actual && f.actual.certainty !== "unknown");
    const buckets = [
      { bucket: "0.00–0.50", lo: 0, hi: 0.5 },
      { bucket: "0.50–0.75", lo: 0.5, hi: 0.75 },
      { bucket: "0.75–0.90", lo: 0.75, hi: 0.9 },
      { bucket: "0.90–1.00", lo: 0.9, hi: 1.0001 },
    ].map((b) => {
      const inB = withValue.filter((f) => f.actual!.confidence >= b.lo && f.actual!.confidence < b.hi);
      // "Correct value" for calibration = the value matched (certainty label judged separately).
      const correct = inB.filter((f) => (f.expected.valueDate === undefined || f.actual!.valueDate === f.expected.valueDate) && (f.expected.valueCents === undefined || f.actual!.valueCents === f.expected.valueCents));
      return {
        bucket: b.bucket,
        n: inB.length,
        accuracy: inB.length ? pct(correct.length, inB.length) : null,
        meanConfidence: inB.length ? Math.round((inB.reduce((s, f) => s + f.actual!.confidence, 0) / inB.length) * 100) / 100 : null,
      };
    });
    const ece = buckets.reduce((s, b) => (b.n && b.accuracy != null && b.meanConfidence != null ? s + (b.n / Math.max(withValue.length, 1)) * Math.abs(b.accuracy - b.meanConfidence) : s), 0);

    const times = results.map((r) => r.processingMs).filter((x): x is number => x != null).sort((a, b) => a - b);
    const q = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(p * times.length))]! : 0);

    return {
      provider: opts.provider,
      today: EVAL_TODAY,
      cases: results,
      metrics: {
        extractionAccuracy: pct(facts.filter((f) => f.ok).length, facts.length),
        factsCorrect: facts.filter((f) => f.ok).length,
        factsTotal: facts.length,
        statusAccuracy: pct(results.filter((r) => r.status.ok).length, results.length),
        itemAccuracy: pct(results.filter((r) => r.items.ok).length, results.length),
        falseDeadlineRate: pct(falseDl.length, Math.max(shown.length, 1)),
        falseDeadlines: falseDl.length,
        deadlinesShown: shown.length,
        deadlineRecall: pct(expectedDl - missed, expectedDl),
        evidenceValidationRate: pct(proposed - rejected, proposed),
        evidenceProposed: proposed,
        evidenceRejected: rejected,
        calibration: buckets,
        expectedCalibrationError: Math.round(ece * 1000) / 1000,
        processingMs: { p50: q(0.5), p95: q(0.95), max: times.at(-1) ?? 0 },
        tokens: {
          input: results.reduce((n, r) => n + r.tokens.input, 0),
          output: results.reduce((n, r) => n + r.tokens.output, 0),
        },
      },
    };
  } finally {
    setClock(null);
  }
}

export function formatReport(r: EvalReport): string {
  const m = r.metrics;
  const lines = [
    `LIFEOS extraction eval — provider=${r.provider} today=${r.today} cases=${r.cases.length}`,
    "",
    `  False deadline rate     ${(m.falseDeadlineRate * 100).toFixed(1)}%  (${m.falseDeadlines} of ${m.deadlinesShown} shown)   target: 0`,
    `  Extraction accuracy     ${(m.extractionAccuracy * 100).toFixed(1)}%  (${m.factsCorrect}/${m.factsTotal} facts: value + certainty label)`,
    `  Deadline recall         ${(m.deadlineRecall * 100).toFixed(1)}%`,
    `  Document status         ${(m.statusAccuracy * 100).toFixed(1)}%`,
    `  Items                   ${(m.itemAccuracy * 100).toFixed(1)}%`,
    `  Evidence validation     ${(m.evidenceValidationRate * 100).toFixed(1)}%  (${m.evidenceRejected} of ${m.evidenceProposed} model values rejected as ungrounded/contradicted)`,
    `  Calibration (ECE)       ${m.expectedCalibrationError}`,
    ...m.calibration.map((b) => `      conf ${b.bucket}: n=${b.n} accuracy=${b.accuracy ?? "—"} mean=${b.meanConfidence ?? "—"}`),
    `  Processing time         p50=${m.processingMs.p50}ms p95=${m.processingMs.p95}ms max=${m.processingMs.max}ms`,
    `  Tokens                  input=${m.tokens.input} output=${m.tokens.output} (extraction calls; transcription not counted)`,
    "",
  ];
  for (const c of r.cases) {
    const bad = [
      !c.status.ok ? `status ${c.status.actual} ≠ ${c.status.expected}${c.status.reason ? ` (${c.status.reason})` : ""}` : null,
      ...c.items.notes,
      ...c.facts
        .filter((f) => !f.ok)
        .map(
          (f) =>
            `fact ${f.key}: got ${f.actual ? `${f.actual.certainty} ${f.actual.valueDate ?? f.actual.valueCents ?? ""} [basis=${f.actual.basis} conf=${f.actual.confidence}]` : "none"}, want ${asList(f.expected.certainty).join("/")} ${f.expected.valueDate ?? f.expected.valueCents ?? ""}`,
        ),
      ...c.deadlines.falseDeadlines.map((d) => `FALSE DEADLINE: ${d}`),
      ...c.deadlines.missed.map((d) => `missed deadline: ${d}`),
    ].filter(Boolean);
    const diag = bad.length
      ? `  [type=${c.documentType ?? "—"} conf=${c.classificationConfidence ?? "—"}${c.warnings.length ? ` warnings=${c.warnings.join(",")}` : ""}]` +
        c.actualItems.map((i) => `\n      got item: ${i.kind} "${i.title}"${i.needsReview ? " (needs review)" : ""} ${i.facts.join(" ")}`).join("")
      : "";
    lines.push(`  ${bad.length ? "✗" : "✓"} ${c.id.padEnd(26)} ${c.processingMs ?? "—"}ms  ${bad.join("; ")}${diag}`);
  }
  return lines.join("\n");
}
