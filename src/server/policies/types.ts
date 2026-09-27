import { z } from "zod";

export type PolicyKind = "return" | "warranty";

/** What we ask about. Contains no user data: a store or brand, a product type, and a short product hint. */
export type PolicyQuery = {
  kind: PolicyKind;
  /** Store name (returns) or manufacturer/brand (warranties). */
  subject: string;
  /** Normalized product bucket, e.g. "electronics", "tv", "general". */
  category: string;
  /** e.g. "65-inch QLED TV" (serial-like tokens removed). Helps pick the right policy section. */
  productHint: string | null;
};

export type FetchedPage = { url: string; title: string | null; text: string };

export type PolicyResearch = {
  pages: FetchedPage[];
  searches: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

/** Structured answer extracted ONLY from fetched pages. Every number must be backed by a verbatim quote. */
export const PolicyExtractionSchema = z.object({
  found: z.boolean().describe("true only if a fetched page states the policy for this store/brand and product type"),
  source_url: z.string().describe("URL of the fetched page the quote comes from; empty if not found"),
  quote: z.string().describe("Exact sentence copied character-for-character from that page that states the duration; empty if not found"),
  duration_value: z.number().int().nullable().describe("The number in the quote, e.g. 30 for '30 days', 1 for 'one year'"),
  duration_unit: z.enum(["days", "months", "years"]).nullable(),
  starts_from: z.enum(["purchase", "delivery", "unknown"]).describe("Whether the window counts from purchase or delivery, per the page"),
  category_note: z.string().nullable().describe("Short note when this product type has a different window than the default, e.g. 'Electronics: 15 days'"),
  membership_note: z.string().nullable().describe("Short note if members/loyalty tiers get a longer window, e.g. 'Totaltech members: 60 days'"),
  coverage_note: z.string().nullable().describe("Warranties only: what is covered, in under 12 words"),
});
export type PolicyExtraction = z.infer<typeof PolicyExtractionSchema>;

/** Verified result stored in the shared cache. */
export type PolicyResult = {
  /** Days for return windows, months for warranties. */
  value: number;
  unit: "days" | "months";
  startsFrom: "purchase" | "delivery" | "unknown";
  quote: string;
  sourceUrl: string;
  sourceTitle: string | null;
  categoryNote: string | null;
  membershipNote: string | null;
  coverageNote: string | null;
};
