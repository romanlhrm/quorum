import type { z } from "zod";
import type { LLMProvider, LlmRequest, LlmResult } from "../../domain/ports/llm-provider.ts";
import { writeFixture } from "./fixture-store.ts";
import { resolveRequest } from "./resolve.ts";

/**
 * Wraps a live provider and writes each successful response to a committed
 * fixture, keyed by the same content hash the replay reader looks up. This is
 * the ONLY place that both calls the network and writes fixtures; it is wired
 * solely in `PROVIDER=record` runs. `now` is injected so `recordedAt` is the
 * one piece of provenance that varies — and it lives in the fixture value,
 * never the key.
 */
export class RecordingProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly fixturesDir: string,
    private readonly now: () => string,
  ) {}

  async complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>> {
    const result = await this.inner.complete(req, schema);
    const { hash, resolved } = resolveRequest(req, schema);
    writeFixture(this.fixturesDir, hash, {
      request: resolved,
      response: {
        raw: result.raw,
        usage: result.usage,
        model: result.model,
        stopReason: result.stopReason ?? "end_turn",
        latencyMs: result.latencyMs,
        recordedAt: this.now(),
      },
    });
    return { ...result, providerMode: "record" };
  }
}
