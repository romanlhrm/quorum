import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { RecordingProvider } from "../../src/adapters/llm/recording-provider.ts";
import { readFixture } from "../../src/adapters/llm/fixture-store.ts";
import { resolveRequest } from "../../src/adapters/llm/resolve.ts";
import type { LLMProvider, LlmRequest, LlmResult } from "../../src/domain/ports/llm-provider.ts";

const schema = z.object({ answer: z.number() }).strict();
const req: LlmRequest = { role: "reviewer", system: "S", user: "U", maxTokens: 1024 };

let dir = "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const innerResult: LlmResult<unknown> = {
  parsed: { answer: 4 },
  raw: JSON.stringify({ answer: 4 }),
  usage: { inputTokens: 9, outputTokens: 3 },
  latencyMs: 250,
  model: "claude-sonnet-4-6",
  stopReason: "end_turn",
  attempts: 1,
  providerMode: "live",
};
const inner: LLMProvider = { complete: async () => innerResult as LlmResult<never> };

describe("RecordingProvider", () => {
  test("writes a hash-keyed fixture from the live result and tags the mode record", async () => {
    dir = mkdtempSync(join(tmpdir(), "quorum-rec-"));
    const provider = new RecordingProvider(inner, dir, () => "2026-06-18T12:00:00.000Z");
    const res = await provider.complete(req, schema);
    expect(res.providerMode).toBe("record");

    const { hash } = resolveRequest(req, schema);
    const fixture = readFixture(dir, hash);
    expect(fixture).not.toBeNull();
    expect(fixture!.response.raw).toBe(JSON.stringify({ answer: 4 }));
    expect(fixture!.response.model).toBe("claude-sonnet-4-6");
    expect(fixture!.response.stopReason).toBe("end_turn");
    expect(fixture!.response.recordedAt).toBe("2026-06-18T12:00:00.000Z");
    expect(fixture!.response.usage).toEqual({ inputTokens: 9, outputTokens: 3 });
  });

  test("the written fixture round-trips through the ReplayProvider", async () => {
    const { ReplayProvider } = await import("../../src/adapters/llm/replay-provider.ts");
    const res = await new ReplayProvider(dir).complete(req, schema);
    expect(res.parsed).toEqual({ answer: 4 });
    expect(res.providerMode).toBe("replay");
  });
});
