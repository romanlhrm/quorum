import type { z } from "zod";
import type { LLMProvider, LlmRequest, LlmResult } from "../../domain/ports/llm-provider.ts";
import { readFixture } from "./fixture-store.ts";
import { resolveRequest } from "./resolve.ts";

/**
 * Replays previously-recorded model responses from committed fixtures, keyed by
 * request content hash. It is a PURE READER: no Anthropic client, no fallback
 * provider. A cache miss throws because there is literally nothing else to call
 * — which is exactly why the whole test suite runs offline with no API key, and
 * why "never hits the network in CI" is a structural fact rather than a flag.
 */
export class ReplayProvider implements LLMProvider {
  constructor(private readonly fixturesDir: string) {}

  async complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>> {
    const { hash } = resolveRequest(req, schema);
    const fixture = readFixture(this.fixturesDir, hash);
    if (fixture === null) {
      throw new Error(
        `replay miss: no fixture ${hash}.json for a "${req.role}" call in ${this.fixturesDir}. ` +
          `Re-record with PROVIDER=record (needs ANTHROPIC_API_KEY).`,
      );
    }
    // A corrupt/stale fixture (raw no longer matches the schema) throws here,
    // surfacing the drift loudly instead of returning garbage.
    const parsed = schema.parse(JSON.parse(fixture.response.raw));
    return {
      parsed,
      raw: fixture.response.raw,
      usage: fixture.response.usage,
      latencyMs: fixture.response.latencyMs,
      model: fixture.response.model,
      stopReason: fixture.response.stopReason,
      attempts: 1,
      providerMode: "replay",
    };
  }
}
