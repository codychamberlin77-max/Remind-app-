import { describe, expect, it } from "vitest";
import { DocumentIndex, evidenceContainsAmount, evidenceSupportsCount } from "@/server/extraction/grounding";
import { verifyDate, verifyMoney, verifyText, type VerifyContext } from "@/server/extraction/verify";

const doc = `BEST BUY\nDate: 09/20/2026\nSAMSUNG TV 1,299.99\nTOTAL $1,611.33\nReturns accepted within 15 days\n2-YEAR PROTECTION PLAN`;
const ctx = (over: Partial<VerifyContext> = {}): VerifyContext => ({
  index: new DocumentIndex(doc),
  today: "2026-09-25",
  referenceIso: null,
  order: null,
  readCap: 1,
  warnings: [],
  ...over,
});

describe("grounding", () => {
  it("matches evidence across whitespace/line differences but not paraphrases", () => {
    const i = new DocumentIndex(doc);
    expect(i.containsStrict("TOTAL   $1,611.33")).toBe(true);
    expect(i.containsStrict("Total due $1,611.33")).toBe(false);
  });
  it("finds amounts in many formats", () => {
    expect(evidenceContainsAmount("TOTAL $1,611.33", 1611.33)).toBe(true);
    expect(evidenceContainsAmount("€ 1.299,00", 1299)).toBe(true);
    expect(evidenceContainsAmount("TOTAL $1,611.33", 1611.3)).toBe(false);
  });
  it("supports counts stated in years or weeks", () => {
    expect(evidenceSupportsCount("2-YEAR PROTECTION PLAN", 24, "months")).toBe(true);
    expect(evidenceSupportsCount("within 15 days", 15, "days")).toBe(true);
    expect(evidenceSupportsCount("within 15 days", 30, "days")).toBe(false);
  });
});

describe("verification", () => {
  it("confirms a grounded, well-read date", () => {
    const v = verifyDate({ value: "2026-09-20", evidence: "Date: 09/20/2026", confidence: 0.95 }, ctx(), "pd", { kind: "past" });
    expect(v.certainty).toBe("confirmed");
  });

  it("drops a date whose quote is not on the document", () => {
    const c = ctx();
    const v = verifyDate({ value: "2026-10-20", evidence: "Return by 10/20/2026", confidence: 0.99 }, c, "ret");
    expect(v.certainty).toBe("unknown");
    expect(v.value).toBeNull();
    expect(c.warnings).toContain("ungrounded_date:ret");
  });

  it("trusts its own verification of a verbatim date in a text document, even if the model hedged", () => {
    const v = verifyDate({ value: "2026-09-20", evidence: "Date: 09/20/2026", confidence: 0.6 }, ctx(), "pd", { kind: "past" });
    expect(v.certainty).toBe("confirmed");
  });

  it("resolves a weekday against a printed sent date and confirms it", () => {
    const d = new DocumentIndex("Date: 2026-09-23\nYour trial ends Sunday");
    const v = verifyDate({ value: "2026-09-27", evidence: "Your trial ends Sunday", confidence: 0.7 }, ctx({ index: d, referenceIso: "2026-09-23" }), "trial");
    expect(v.certainty).toBe("confirmed");
  });

  it("never confirms a low-legibility read", () => {
    const v = verifyDate({ value: "2026-09-20", evidence: "Date: 09/20/2026", confidence: 0.95 }, ctx({ readCap: 0.45 }), "pd");
    expect(v.certainty).toBe("estimated");
    expect(v.basis).toBe("unclear_on_document");
  });

  it("rejects future purchase dates", () => {
    const d = new DocumentIndex("Date: 12/20/2026");
    const v = verifyDate({ value: "2026-12-20", evidence: "Date: 12/20/2026", confidence: 0.95 }, ctx({ index: d }), "pd", { kind: "past" });
    expect(v.certainty).toBe("unknown");
  });

  it("drops amounts that aren't quoted", () => {
    expect(verifyMoney({ value: 1299, currency: "USD", evidence: "TOTAL $1,299.00", confidence: 0.9 }, ctx(), "t").certainty).toBe("unknown");
    expect(verifyMoney({ value: 1611.33, currency: "USD", evidence: "TOTAL $1,611.33", confidence: 0.9 }, ctx(), "t").certainty).toBe("confirmed");
  });

  it("marks ungrounded text as estimated/inferred, never confirmed", () => {
    const v = verifyText({ value: "Target", evidence: "TARGET STORE #12", confidence: 0.99 }, ctx(), "m");
    expect(v.certainty).toBe("estimated");
    expect(v.basis).toBe("inferred");
  });
});

describe("real-model regressions", () => {
  it("treats a brand fused into a product name as grounded (Apple → AppleCare+)", () => {
    const d = new DocumentIndex("AppleCare+ for Mac\nProof of Coverage");
    const v = verifyText({ value: "Apple", evidence: "AppleCare+ for Mac", confidence: 0.9 }, ctx({ index: d }), "provider");
    expect(v.certainty).toBe("confirmed");
  });

  it("an uncertain provider or coverage note doesn't put the whole item up for review", async () => {
    const { factNeedsReview } = await import("@/server/derivation/plan");
    expect(factNeedsReview({ key: "provider", certainty: "estimated", basis: "unclear_on_document" })).toBe(false);
    expect(factNeedsReview({ key: "warranty_end", certainty: "estimated", basis: "unclear_on_document" })).toBe(true);
    expect(factNeedsReview({ key: "warranty_end", certainty: "estimated", basis: "merchant_policy" })).toBe(false);
    expect(factNeedsReview({ key: "total", certainty: "estimated", basis: "inferred", userConfirmedAt: new Date() })).toBe(false);
  });
});
