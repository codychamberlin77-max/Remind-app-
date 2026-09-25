import type { Classification, Transcription } from "@/server/extraction/schemas";
import type { AIProvider, GenerateRequest, GenerateResult } from "../provider";

/**
 * Deterministic provider. It replays recorded model responses matched by a
 * distinctive substring of the document text or by the upload's SHA-256.
 *
 * Recordings deliberately include realistic model mistakes (made-up dates,
 * misread numbers) so tests exercise the validation layer, not the happy path.
 * Documents with no recording are classified as "other" with low confidence —
 * the honest answer when we don't know.
 */
export type MockRecording = {
  id: string;
  match: { textIncludes?: string; sha256?: string };
  classify?: Classification;
  transcribe?: Transcription;
  /** Recorded output, or a function of the document text (for generated samples). */
  extract?: unknown | ((text: string) => unknown);
  /** Simulated model latency, for UI / perf testing. */
  latencyMs?: number;
};

const registry = new Map<string, MockRecording>();

export function registerMockRecordings(recs: MockRecording[]) {
  for (const r of recs) registry.set(r.id, r);
}
export function clearMockRecordings() {
  registry.clear();
}

async function loadBuiltins() {
  const { SAMPLE_RECORDINGS } = await import("@/server/samples/recordings");
  registerMockRecordings(SAMPLE_RECORDINGS);
  // Outside production, also replay the evaluation fixtures so they can be uploaded through the UI.
  if (process.env.NODE_ENV !== "production" || process.env.LIFEOS_MOCK_FIXTURES === "1") {
    try {
      const { readFile } = await import("node:fs/promises");
      const file = process.env.LIFEOS_MOCK_RECORDINGS ?? `${process.cwd()}/tests/evals/fixtures/recordings.json`;
      registerMockRecordings(JSON.parse(await readFile(file, "utf8")) as MockRecording[]);
    } catch {
      /* fixtures not present — fine */
    }
  }
}

function textOf(req: GenerateRequest<unknown>): string {
  return req.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function find(req: GenerateRequest<unknown>): MockRecording | undefined {
  const text = textOf(req);
  const sha = req.localHints?.sourceSha256;
  for (const r of registry.values()) {
    if (r.match.sha256 && sha && r.match.sha256 === sha) return r;
  }
  for (const r of registry.values()) {
    if (r.match.textIncludes && text.includes(r.match.textIncludes)) return r;
  }
  return undefined;
}

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  private ready: Promise<void>;

  constructor() {
    this.ready = loadBuiltins();
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    await this.ready;
    const started = Date.now();
    const rec = find(req as GenerateRequest<unknown>);
    let raw: unknown;
    switch (req.task) {
      case "classify":
        raw = rec?.classify ?? {
          document_type: "other",
          confidence: 0.2,
          is_actionable: false,
          reason: "No recorded response for this document.",
        };
        break;
      case "transcribe":
        raw = rec?.transcribe ?? { text: "", legibility: "poor" };
        break;
      case "extract":
        if (!rec?.extract) throw new Error(`mock: no extraction recorded (${rec?.id ?? "unmatched"})`);
        raw = typeof rec.extract === "function" ? (rec.extract as (t: string) => unknown)(textOf(req as GenerateRequest<unknown>)) : rec.extract;
        break;
      case "parse_search":
        throw new Error("mock: parse_search not recorded");
    }
    if (rec?.latencyMs) await new Promise((r) => setTimeout(r, rec.latencyMs));
    // Same contract as a real provider: output must satisfy the schema.
    const data = req.schema.parse(raw);
    return {
      data,
      raw,
      model: `mock:${rec?.id ?? "none"}`,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: Date.now() - started,
    };
  }
}
