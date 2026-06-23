import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "../../domain/ports/llm-provider.ts";
import { systemClock } from "../system-clock.ts";
import {
  AnthropicProvider,
  type AnthropicCreateParams,
  type AnthropicMessage,
  type MessageCreator,
} from "./anthropic-provider.ts";
import { RecordingProvider } from "./recording-provider.ts";
import { ReplayProvider } from "./replay-provider.ts";

export type ProviderModeName = "replay" | "record" | "live";

/** Default to replay so a clone runs offline; opt into the network explicitly. */
export function resolveMode(env: Record<string, string | undefined>): ProviderModeName {
  const v = (env["PROVIDER"] ?? "replay").toLowerCase();
  if (v === "replay" || v === "record" || v === "live") return v;
  throw new Error(`unknown PROVIDER="${v}" (expected replay | record | live)`);
}

/**
 * The ONLY place the Anthropic client is constructed. It is built lazily inside
 * the live/record branches, so replay never needs an API key.
 */
function liveCreator(): MessageCreator {
  const client = new Anthropic({ maxRetries: 4 }); // SDK owns transport backoff+jitter
  return async (params: AnthropicCreateParams): Promise<AnthropicMessage> => {
    // params is a structural subset of the SDK's create body, validated field-
    // by-field against the SDK types and by the AnthropicProvider unit tests.
    const message = await client.messages.create(params as never);
    return message as unknown as AnthropicMessage;
  };
}

export function makeProvider(opts: { mode: ProviderModeName; fixturesDir: string }): LLMProvider {
  switch (opts.mode) {
    case "replay":
      return new ReplayProvider(opts.fixturesDir);
    case "live":
      return new AnthropicProvider(liveCreator(), systemClock);
    case "record":
      return new RecordingProvider(
        new AnthropicProvider(liveCreator(), systemClock),
        opts.fixturesDir,
        () => new Date().toISOString(),
      );
  }
}
