import type { z } from "zod";
import type { Clock } from "../../domain/ports/clock.ts";
import type { LLMProvider, LlmRequest, LlmResult } from "../../domain/ports/llm-provider.ts";
import { toJsonSchema } from "../../domain/schemas/to-json-schema.ts";
import { resolveTier } from "./tier-config.ts";

/** The slice of the Anthropic Message response this adapter reads. */
export interface AnthropicMessage {
  readonly content: Array<{ type: string; text?: string }>;
  readonly usage: { input_tokens: number; output_tokens: number };
  readonly model: string;
  readonly stop_reason: string | null;
}

/** The request body we send — native structured outputs, no temperature. */
export interface AnthropicCreateParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly messages: Array<{ role: "user"; content: string }>;
  readonly output_config: {
    readonly effort: string;
    readonly format: { readonly type: "json_schema"; readonly schema: Record<string, unknown> };
  };
}

/** Injected so the adapter is fully testable offline (no SDK, no network). */
export type MessageCreator = (params: AnthropicCreateParams) => Promise<AnthropicMessage>;

export interface AnthropicProviderOpts {
  /** Max schema-validation retries before failing (default 2). */
  readonly maxSchemaRetries?: number;
}

function extractJsonText(msg: AnthropicMessage): string {
  const block = msg.content.find((b) => b.type === "text" && typeof b.text === "string");
  return block?.text ?? "";
}

/**
 * Live provider over the Anthropic Messages API. Uses native structured outputs
 * (`output_config.format = json_schema`) to constrain the model to the derived
 * schema, plus `output_config.effort` for the role's tier. Transport retries
 * (429/5xx) are the SDK's job; this adapter owns the schema-validation retry
 * loop (feed the Zod error back, re-issue) and maps refusals to a hard failure.
 */
export class AnthropicProvider implements LLMProvider {
  private readonly maxSchemaRetries: number;

  constructor(
    private readonly create: MessageCreator,
    private readonly clock: Clock,
    opts: AnthropicProviderOpts = {},
  ) {
    this.maxSchemaRetries = opts.maxSchemaRetries ?? 2;
  }

  async complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>> {
    const tier = resolveTier(req.role);
    const schemaJson = toJsonSchema(schema);
    const start = this.clock.now();

    let attempts = 0;
    let userContent = req.user;
    let lastError: unknown;

    while (attempts <= this.maxSchemaRetries) {
      attempts++;
      const msg = await this.create({
        model: tier.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: userContent }],
        output_config: { effort: tier.effort, format: { type: "json_schema", schema: schemaJson } },
      });

      if (msg.stop_reason === "refusal") {
        // Non-retryable — refusing again wastes calls.
        throw new Error(`anthropic: model refused the "${req.role}" request (stop_reason=refusal)`);
      }

      const raw = extractJsonText(msg);
      try {
        const parsed = schema.parse(JSON.parse(raw));
        return {
          parsed,
          raw,
          usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
          latencyMs: this.clock.now() - start,
          model: msg.model,
          stopReason: msg.stop_reason,
          attempts,
          providerMode: "live",
        };
      } catch (error) {
        lastError = error;
        userContent =
          `${req.user}\n\nYour previous response was invalid JSON for the required schema: ` +
          `${(error as Error).message}\nReturn ONLY a JSON object matching the schema.`;
      }
    }

    throw new Error(
      `anthropic: "${req.role}" output failed schema validation after ${attempts} attempts: ${(lastError as Error)?.message}`,
    );
  }
}
