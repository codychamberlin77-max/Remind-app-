import { describe, expect, it } from "vitest";
import { priorityReason, priorityScore, tierFor, type PrioritizableAction } from "@/server/derivation/priority";

const today = "2026-09-25";
const a = (over: Partial<PrioritizableAction>): PrioritizableAction => ({
  type: "return",
  dueOn: "2026-09-28",
  dueCertainty: "confirmed",
  estimatedValueCents: 129_900,
  currency: "USD",
  consequence: "lose_money",
  confidence: 0.9,
  ...over,
});

describe("prioritization", () => {
  it("ranks a $1,299 return in 3 days above a $9.99 renewal in 30 days", () => {
    const big = priorityScore(a({}), today);
    const small = priorityScore(a({ type: "review_renewal", dueOn: "2026-10-25", estimatedValueCents: 999, consequence: "charged" }), today);
    expect(big).toBeGreaterThan(small * 10);
  });

  it("puts a cheap trial ending tomorrow in Needs Attention", () => {
    expect(tierFor(a({ type: "cancel_trial", dueOn: "2026-09-26", estimatedValueCents: 1999, consequence: "charged" }), today)).toBe("needs_attention");
  });

  it("puts a $431 credit expiring in 21 days in Needs Attention and a far warranty in Later", () => {
    expect(tierFor(a({ type: "use_credit", dueOn: "2026-10-16", estimatedValueCents: 43_100 }), today)).toBe("needs_attention");
    expect(tierFor(a({ type: "warranty_expiring", dueOn: "2028-09-20", consequence: "lose_coverage" }), today)).toBe("later");
  });

  it("dampens estimated deadlines but never hides them", () => {
    expect(priorityScore(a({ dueCertainty: "estimated" }), today)).toBeLessThan(priorityScore(a({}), today));
    expect(priorityScore(a({ dueCertainty: "estimated" }), today)).toBeGreaterThan(0);
  });

  it("explains why, and labels estimates", () => {
    expect(priorityReason(a({}), today)).toBe("Your $1,299 return window closes in 3 days.");
    expect(priorityReason(a({ dueCertainty: "estimated", dueOn: "2026-10-07" }), today)).toBe("Your $1,299 return window likely closes in 12 days (estimated).");
  });
});
