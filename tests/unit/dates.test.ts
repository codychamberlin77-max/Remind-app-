import { describe, expect, it } from "vitest";
import { addMonths, checkDateAgainstEvidence, detectDateOrder, parseDates, todayIn } from "@/server/extraction/dates";

describe("date parsing & evidence checks", () => {
  it("parses common receipt formats", () => {
    const iso = (s: string) => parseDates(s, { referenceIso: "2026-09-25" }).map((c) => c.iso);
    expect(iso("September 10, 2026")).toContain("2026-09-10");
    expect(iso("Sept. 10 2026")).toContain("2026-09-10");
    expect(iso("10 Sep 2026")).toContain("2026-09-10");
    expect(iso("2026-09-10")).toContain("2026-09-10");
    expect(iso("09/20/2026")).toEqual(["2026-09-20"]);
    expect(iso("9/20/26")).toEqual(["2026-09-20"]);
  });

  it("flags day/month ambiguity instead of guessing", () => {
    const c = checkDateAgainstEvidence("2026-04-03", "Date: 03/04/2026", { referenceIso: null, order: null });
    expect(c.status).toBe("ambiguous");
    if (c.status === "ambiguous") expect(c.alternative).toBe("2026-03-04");
  });

  it("uses the document's own unambiguous dates to settle order", () => {
    expect(detectDateOrder("Ordered 09/20/2026, ships 03/04/2026")).toBe("MDY");
    expect(detectDateOrder("Date 20/09/2026 and 03/04/2026")).toBe("DMY");
    const c = checkDateAgainstEvidence("2026-03-04", "03/04/2026", { order: "MDY" });
    expect(c.status).toBe("supported");
  });

  it("rejects a date the evidence doesn't say (hallucination guard)", () => {
    const c = checkDateAgainstEvidence("2026-10-12", "automatically renew on October 21, 2026", {});
    expect(c.status).toBe("unsupported");
  });

  it("resolves weekday-only phrases relative to the reference date", () => {
    // 2026-09-23 is a Wednesday → "Sunday" = 2026-09-27
    expect(checkDateAgainstEvidence("2026-09-27", "trial ends Sunday", { referenceIso: "2026-09-23" }).status).toBe("supported");
    expect(checkDateAgainstEvidence("2026-09-26", "trial ends Sunday", { referenceIso: "2026-09-23" }).status).toBe("unsupported");
  });

  it("does month math at month ends and computes today in the user's timezone", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-09-20", 24)).toBe("2028-09-20");
    // 02:00 UTC on Sep 26 is still Sep 25 in New York.
    expect(todayIn("America/New_York", new Date("2026-09-26T02:00:00Z"))).toBe("2026-09-25");
    expect(todayIn("Asia/Tokyo", new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-26");
  });
});
