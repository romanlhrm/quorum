import { describe, expect, test } from "bun:test";
import { makeProvider, resolveMode } from "../../src/adapters/llm/make-provider.ts";

describe("resolveMode", () => {
  test("defaults to replay so a fresh clone runs offline", () => {
    expect(resolveMode({})).toBe("replay");
    expect(resolveMode({ PROVIDER: undefined })).toBe("replay");
  });

  test("accepts the three known modes, case-insensitively", () => {
    expect(resolveMode({ PROVIDER: "record" })).toBe("record");
    expect(resolveMode({ PROVIDER: "LIVE" })).toBe("live");
  });

  test("rejects an unknown mode loudly", () => {
    expect(() => resolveMode({ PROVIDER: "wat" })).toThrow(/unknown PROVIDER/i);
  });
});

describe("makeProvider", () => {
  test("the replay branch needs no API key (never constructs the SDK client)", () => {
    const provider = makeProvider({ mode: "replay", fixturesDir: "fixtures/llm" });
    expect(typeof provider.complete).toBe("function");
  });
});
