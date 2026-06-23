import { describe, expect, test } from "bun:test";
import { requestHash, type ResolvedRequest } from "../../src/adapters/llm/request-hash.ts";

const base: ResolvedRequest = {
  model: "claude-sonnet-4-6",
  effort: "medium",
  maxTokens: 4096,
  system: "You are a reviewer.",
  user: "Review this hunk.",
  schemaJson: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a", "b"] },
};

describe("requestHash", () => {
  test("is a 64-char hex sha256", () => {
    expect(requestHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is stable under top-level key insertion order", () => {
    const reordered: ResolvedRequest = {
      user: base.user,
      schemaJson: base.schemaJson,
      model: base.model,
      maxTokens: base.maxTokens,
      system: base.system,
      effort: base.effort,
    };
    expect(requestHash(reordered)).toBe(requestHash(base));
  });

  test("is stable under nested schemaJson key order (the zod-output trap)", () => {
    const flipped: ResolvedRequest = {
      ...base,
      schemaJson: { required: ["a", "b"], properties: { b: { type: "number" }, a: { type: "string" } }, type: "object" },
    };
    expect(requestHash(flipped)).toBe(requestHash(base));
  });

  test("normalizes CRLF to LF in system and user", () => {
    expect(requestHash({ ...base, system: "You are\r\na reviewer." })).toBe(
      requestHash({ ...base, system: "You are\na reviewer." }),
    );
  });

  test("changes when any hashed field changes", () => {
    const h = requestHash(base);
    expect(requestHash({ ...base, model: "claude-opus-4-8" })).not.toBe(h);
    expect(requestHash({ ...base, effort: "high" })).not.toBe(h);
    expect(requestHash({ ...base, maxTokens: 8192 })).not.toBe(h);
    expect(requestHash({ ...base, system: "different" })).not.toBe(h);
    expect(requestHash({ ...base, user: "different" })).not.toBe(h);
    expect(requestHash({ ...base, schemaJson: { type: "object" } })).not.toBe(h);
  });
});
