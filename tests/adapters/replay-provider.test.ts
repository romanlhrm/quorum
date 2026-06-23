import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ReplayProvider } from "../../src/adapters/llm/replay-provider.ts";
import { resolveRequest } from "../../src/adapters/llm/resolve.ts";
import type { LlmRequest } from "../../src/domain/ports/llm-provider.ts";

const schema = z.object({ ok: z.boolean() }).strict();
const req: LlmRequest = { role: "reviewer", system: "S", user: "U", maxTokens: 1024 };

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "quorum-fixtures-"));
  dirs.push(d);
  return d;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function writeFixture(dir: string, raw: string): void {
  const { hash, resolved } = resolveRequest(req, schema);
  const fixture = {
    request: resolved,
    response: {
      raw,
      usage: { inputTokens: 11, outputTokens: 7 },
      model: "claude-sonnet-4-6",
      stopReason: "tool_use",
      latencyMs: 42,
      recordedAt: "2026-06-18T00:00:00.000Z",
    },
  };
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(fixture));
}

describe("ReplayProvider", () => {
  test("returns the parsed, validated result for a present fixture", async () => {
    const dir = tmp();
    writeFixture(dir, JSON.stringify({ ok: true }));
    const provider = new ReplayProvider(dir);
    const res = await provider.complete(req, schema);
    expect(res.parsed).toEqual({ ok: true });
    expect(res.providerMode).toBe("replay");
    expect(res.model).toBe("claude-sonnet-4-6");
    expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(res.latencyMs).toBe(42);
    expect(res.attempts).toBe(1);
  });

  test("THROWS on a cache miss — never falls through to the network", async () => {
    const provider = new ReplayProvider(tmp()); // empty dir
    await expect(provider.complete(req, schema)).rejects.toThrow(/replay (miss|cache)/i);
  });

  test("throws on a corrupt (schema-invalid) fixture rather than returning garbage", async () => {
    const dir = tmp();
    writeFixture(dir, JSON.stringify({ ok: "not-a-boolean" }));
    const provider = new ReplayProvider(dir);
    await expect(provider.complete(req, schema)).rejects.toThrow();
  });
});
