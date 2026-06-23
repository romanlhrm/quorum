import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ReplayProvider } from "../../src/adapters/llm/replay-provider.ts";
import { DEFAULT_KEEP } from "../../src/config.ts";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";
import type { Clock } from "../../src/domain/ports/clock.ts";
import { TruthManifest } from "../../src/domain/schemas/eval.ts";
import { runEval, type EvalCase } from "../../src/eval/run-eval.ts";

const DIR = "eval/dataset";

function loadCases(): EvalCase[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".diff"))
    .map((f) => f.slice(0, -5))
    .sort()
    .map((name) => ({
      name,
      diff: parseDiff(readFileSync(join(DIR, `${name}.diff`), "utf8")),
      truth: TruthManifest.parse(JSON.parse(readFileSync(join(DIR, `${name}.truth.json`), "utf8"))),
    }));
}

function counterClock(): Clock {
  let t = 0;
  return { now: () => (t += 1) };
}

describe("committed eval dataset replays offline", () => {
  test("the harness runs end-to-end on the committed fixtures with no key", async () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(5);

    const result = await runEval(
      cases,
      { provider: new ReplayProvider("fixtures/llm"), cfg: DEFAULT_KEEP, concurrency: 6, clock: counterClock() },
      3,
    );

    // Structural invariants that hold for ANY model output (the verifier only
    // ever REMOVES findings, so it can never add a false positive or a true
    // positive). The empirical precision gain is reported in the README, not
    // asserted here — that would be testing the model, not the harness.
    expect(result.withVerifier.fp).toBeLessThanOrEqual(result.withoutVerifier.fp);
    expect(result.withVerifier.tp).toBeLessThanOrEqual(result.withoutVerifier.tp);
    expect(result.withVerifier.recall).toBeLessThanOrEqual(result.withoutVerifier.recall + 1e-9);
    for (const s of [result.withVerifier, result.withoutVerifier]) {
      expect(s.recall).toBeGreaterThanOrEqual(0);
      expect(s.recall).toBeLessThanOrEqual(1);
      expect(s.precision).toBeGreaterThanOrEqual(0);
      expect(s.precision).toBeLessThanOrEqual(1);
    }
    expect(result.perCase).toHaveLength(cases.length);
  });
});
