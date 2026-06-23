import type { z } from "zod";

/**
 * The single port the domain uses to talk to a language model. Every concrete
 * provider (replay reader, live Anthropic adapter) implements this; the domain
 * never imports the SDK. `role` selects the model+effort tier in the adapter,
 * so callers express intent ("this is a verifier call"), not configuration.
 */
export type Role = "planner" | "reviewer" | "verifier" | "router";

export interface LlmRequest {
  readonly role: Role;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type ProviderMode = "live" | "replay" | "record";

export interface LlmResult<T> {
  /** The model's output, parsed and validated against the caller's schema. */
  readonly parsed: T;
  /** The raw JSON text the model returned (before parsing). */
  readonly raw: string;
  readonly usage: LlmUsage;
  readonly latencyMs: number;
  readonly model: string;
  /** The model's stop reason (e.g. end_turn, max_tokens, refusal), or null. */
  readonly stopReason: string | null;
  /** How many attempts the provider made (schema-validation retries). */
  readonly attempts: number;
  readonly providerMode: ProviderMode;
}

export interface LLMProvider {
  complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>>;
}
