import { beforeAll, describe, expect, it } from "vitest";
import { formatReport, runEval, type EvalReport } from "../evals/evaluate";
import { resetDb } from "../helpers/db";

/**
 * The extraction evaluation suite, run against the deterministic provider.
 * Recordings include realistic model mistakes; the pipeline must catch them.
 */
describe("extraction evaluation (mock provider)", () => {
  let report: EvalReport;
  beforeAll(async () => {
    await resetDb();
    report = await runEval({ provider: "mock" });
    console.log(formatReport(report));
  }, 120_000);

  it("shows zero false deadlines", () => {
    expect(report.cases.flatMap((c) => c.deadlines.falseDeadlines)).toEqual([]);
    expect(report.metrics.falseDeadlineRate).toBe(0);
  });

  it("gets every expected fact and certainty label right", () => {
    const wrong = report.cases.flatMap((c) => c.facts.filter((f) => !f.ok).map((f) => `${c.id}.${f.key}`));
    expect(wrong).toEqual([]);
  });

  it("finds every expected deadline", () => {
    expect(report.cases.flatMap((c) => c.deadlines.missed.map((m) => `${c.id}: ${m}`))).toEqual([]);
  });

  it("assigns the right document status and items", () => {
    expect(report.cases.filter((c) => !c.status.ok).map((c) => `${c.id}: ${c.status.actual}`)).toEqual([]);
    expect(report.cases.filter((c) => !c.items.ok).map((c) => `${c.id}: ${c.items.notes.join(", ")}`)).toEqual([]);
  });

  it("rejects the ungrounded values planted in the recordings", () => {
    expect(report.metrics.evidenceRejected).toBeGreaterThan(0);
    const halluc = report.cases.find((c) => c.id === "hallucinated_return_date")!;
    expect(halluc.evidence.rejected).toBeGreaterThanOrEqual(3);
  });
});
