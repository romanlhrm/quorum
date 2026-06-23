import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { runEval, type EvalCase } from "../../src/eval/run-eval.ts";
import { renderEvalTable } from "../../src/render/eval-table.ts";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";
import type { Clock } from "../../src/domain/ports/clock.ts";
import type { LLMProvider, LlmRequest, LlmResult } from "../../src/domain/ports/llm-provider.ts";

const diff = parseDiff(
  [
    "diff --git a/f.ts b/f.ts",
    "--- a/f.ts",
    "+++ b/f.ts",
    "@@ -1,2 +1,4 @@",
    " function f(x) {",
    "+  const y = x.value;",
    "+  const z = compute();",
    " }",
  ].join("\n"),
);

// Reviewer flags a REAL defect (line 2) and a false positive (line 3).
// The verifier refutes only the false positive.
function provider(): LLMProvider {
  return {
    async complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>> {
      let parsed: unknown;
      if (req.role === "planner") {
        parsed = { items: [{ file: "f.ts", hunkIndex: 0, concerns: ["correctness"], reason: "logic" }] };
      } else if (req.role === "reviewer") {
        parsed = {
          findings: [
            { lineStart: 2, lineEnd: 2, severity: "high", title: "Real null deref", rationale: "x may be null", suggestedFix: null, confidence: 0.9 },
            { lineStart: 3, lineEnd: 3, severity: "high", title: "FALSE-POSITIVE", rationale: "looks odd", suggestedFix: null, confidence: 0.6 },
          ],
        };
      } else {
        const refute = req.user.includes("FALSE-POSITIVE");
        parsed = { outcome: refute ? "refuted" : "upheld", confidence: 0.9, reasoning: "judged" };
      }
      return {
        parsed: schema.parse(parsed),
        raw: JSON.stringify(parsed),
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 1,
        model: "m",
        stopReason: "end_turn",
        attempts: 1,
        providerMode: "replay",
      };
    },
  };
}

function clock(): Clock {
  let t = 0;
  return { now: () => (t += 1) };
}

const cases: EvalCase[] = [
  {
    name: "null-deref",
    diff,
    truth: { kind: "defect", defects: [{ defectId: "d1", file: "f.ts", lineStart: 2, lineEnd: 2, type: "null-deref", concern: "correctness", severity: "high", note: "" }] },
  },
];

describe("runEval", () => {
  test("the verifier raises precision without costing recall", async () => {
    const result = await runEval(cases, { provider: provider(), cfg: { confidenceThreshold: 0.6, voteFloor: 2 }, concurrency: 4, clock: clock() }, 0);
    // verifier removes the false positive -> precision up, fp down
    expect(result.withVerifier.precision).toBeGreaterThan(result.withoutVerifier.precision);
    expect(result.withVerifier.fp).toBeLessThan(result.withoutVerifier.fp);
    // the real defect is still found either way -> no recall cost
    expect(result.withVerifier.recall).toBeCloseTo(result.withoutVerifier.recall);
    expect(result.withVerifier.recall).toBeCloseTo(1);
  });

  test("produces a sensitivity sweep across thresholds", async () => {
    const result = await runEval(cases, { provider: provider(), cfg: { confidenceThreshold: 0.6, voteFloor: 2 }, concurrency: 4, clock: clock() }, 0);
    expect(result.sensitivity.map((s) => s.threshold)).toEqual([0.5, 0.6, 0.7]);
  });

  test("renders a markdown scoreboard naming the verifier delta", () => {
    const table = renderEvalTable({
      withVerifier: { defects: 1, findings: 1, tp: 1, fp: 0, missed: 0, recall: 1, precision: 1, falsePositiveRate: 0 },
      withoutVerifier: { defects: 1, findings: 2, tp: 1, fp: 1, missed: 0, recall: 1, precision: 0.5, falsePositiveRate: 0.5 },
      sensitivity: [{ threshold: 0.6, score: { defects: 1, findings: 1, tp: 1, fp: 0, missed: 0, recall: 1, precision: 1, falsePositiveRate: 0 } }],
      perCase: [{ name: "null-deref", kept: 1, total: 2, runStatus: "success" }],
    });
    expect(table.toLowerCase()).toContain("verifier");
    expect(table.toLowerCase()).toContain("recall");
    expect(table).toContain("null-deref");
  });
});
