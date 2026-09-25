import type { z } from "zod";
import { env } from "@/server/env";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: "image/jpeg" | "image/png" | "image/webp"; data: Buffer }
  | { type: "pdf"; data: Buffer };

export type AITask = "classify" | "transcribe" | "extract" | "parse_search";

export type GenerateRequest<T> = {
  task: AITask;
  system: string;
  content: ContentPart[];
  schema: z.ZodType<T>;
  /** fast = cheap/low-latency model; strong = best extraction quality. Mapped to model IDs via env. */
  tier: "fast" | "strong";
  maxTokens?: number;
  /**
   * Local-only hints for the deterministic mock (e.g. the upload's hash).
   * NEVER sent to an external provider.
   */
  localHints?: { sourceSha256?: string };
};

export type GenerateResult<T> = {
  data: T;
  /** Unvalidated output as returned, for debugging and evals. */
  raw: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
};

export class AIProviderError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Provider-independent structured generation. Implementations must return data
 * that already passed `schema` (or throw); callers still run their own
 * grounding and sanity checks on top.
 */
export interface AIProvider {
  readonly id: "anthropic" | "openai" | "mock";
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

const cache = new Map<string, AIProvider>();

export async function getProvider(id: "anthropic" | "openai" | "mock" = env().AI_PROVIDER): Promise<AIProvider> {
  const hit = cache.get(id);
  if (hit) return hit;
  let p: AIProvider;
  switch (id) {
    case "mock": {
      const { MockProvider } = await import("./providers/mock");
      p = new MockProvider();
      break;
    }
    case "anthropic": {
      const { AnthropicProvider } = await import("./providers/anthropic");
      p = new AnthropicProvider();
      break;
    }
    case "openai":
      throw new Error("The OpenAI provider is not implemented yet. Set AI_PROVIDER=anthropic or mock.");
  }
  cache.set(id, p);
  return p;
}
