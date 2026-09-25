import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "@/server/env";
import { AIProviderError, type AIProvider, type ContentPart, type GenerateRequest, type GenerateResult } from "../provider";

/** Defaults; override with AI_MODEL_FAST / AI_MODEL_STRONG. */
const DEFAULT_FAST = "claude-haiku-4-5";
const DEFAULT_STRONG = "claude-opus-5";

function toBlocks(parts: ContentPart[]): Anthropic.Beta.BetaContentBlockParam[] {
  // Documents/images first, then instructions.
  const media: Anthropic.Beta.BetaContentBlockParam[] = [];
  const text: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const p of parts) {
    if (p.type === "image") {
      media.push({ type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data.toString("base64") } });
    } else if (p.type === "pdf") {
      media.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data.toString("base64") } });
    } else {
      text.push({ type: "text", text: p.text });
    }
  }
  return [...media, ...text];
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  private client: Anthropic;
  private models: { fast: string; strong: string };

  constructor() {
    const e = env();
    // Only document content (already redacted) is sent. The API does not train on inputs by default.
    this.client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 });
    this.models = { fast: e.AI_MODEL_FAST || DEFAULT_FAST, strong: e.AI_MODEL_STRONG || DEFAULT_STRONG };
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = this.models[req.tier];
    const isHaiku = model.startsWith("claude-haiku");
    const started = Date.now();
    try {
      const res = await this.client.beta.messages.parse({
        model,
        max_tokens: req.maxTokens ?? (req.task === "classify" ? 1024 : 8000),
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: toBlocks(req.content) }],
        output_config: {
          format: betaZodOutputFormat(req.schema),
          // Latency matters for the first-upload moment; extraction is well-specified.
          ...(isHaiku ? {} : { effort: req.task === "extract" ? "medium" : "low" }),
        },
        // Server-side fallback on a policy refusal (default routing by refusal category).
        ...(isHaiku ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      });

      if (res.stop_reason === "refusal") throw new AIProviderError("model declined the request", false);
      if (res.stop_reason === "max_tokens") throw new AIProviderError("output truncated", true);
      const parsed = res.parsed_output;
      if (parsed == null) throw new AIProviderError("no structured output returned", true);

      return {
        data: parsed as T,
        raw: parsed,
        model: res.model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      if (e instanceof AIProviderError) throw e;
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        throw new AIProviderError(`anthropic transient error: ${(e as Error).message}`, true);
      }
      if (e instanceof Anthropic.APIError) {
        throw new AIProviderError(`anthropic error ${e.status}: ${e.message}`, false);
      }
      throw new AIProviderError(`anthropic output invalid: ${(e as Error).message}`, true);
    }
  }
}
