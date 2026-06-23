import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { runReview } from "../../src/domain/orchestrator.ts";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";
import type { Clock } from "../../src/domain/ports/clock.ts";
import type { LLMProvider, LlmRequest, LlmResult } from "../../src/domain/ports/llm-provider.ts";

const diff = parseDiff(
  [
    "diff --git a/app.ts b/app.ts",
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 1;",
    "+const b = 2;",
  ].join("\n"),
);

function counterClock(): Clock {
  let t = 0;
  return { now: () => (t += 1000) };
}

/** A provider that answers by role and can be told to throw for matching requests. */
function scripted(opts: { failOn?: (req: LlmRequest) => boolean } = {}): LLMProvider {
  return {
    async complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>> {
      if (opts.failOn?.(req)) throw new Error(`scripted failure for ${req.role}`);
      let parsed: unknown;
      if (req.role === "planner") {
        parsed = { items: [{ file: "app.ts", hunkIndex: 0, concerns: ["correctness", "security"], reason: "x" }] };
      } else if (req.role === "reviewer") {
        parsed = { findings: [{ lineStart: 2, lineEnd: 2, severity: "high", title: "Issue", rationale: "r", suggestedFix: null, confidence: 0.9 }] };
      } else {
        parsed = { outcome: "upheld", confidence: 0.9, reasoning: "real" };
      }
      return {
        parsed: schema.parse(parsed),
        raw: JSON.stringify(parsed),
        usage: { inputTokens: 100, outputTokens: 20 },
        latencyMs: 5,
        model: req.role === "reviewer" ? "claude-sonnet-4-6" : "claude-opus-4-8",
        stopReason: "end_turn",
        attempts: 1,
        providerMode: "replay",
      };
    },
  };
}

const deps = () => ({
  provider: scripted(),
  cfg: { confidenceThreshold: 0.6, voteFloor: 2 },
  concurrency: 4,
  runId: "run-test",
  clock: counterClock(),
});

describe("runReview — happy path", () => {
  test("produces a success report with the corroborated findings kept", async () => {
    const { report } = await runReview(diff, deps());
    expect(report.runStatus).toBe("success");
    expect(report.findings).toHaveLength(2); // correctness + security, each at line 2
    expect(report.findings.every((f) => f.lineStart === 2)).toBe(true);
    expect(new Set(report.findings.map((f) => f.concern))).toEqual(new Set(["correctness", "security"]));
    expect(report.failedNodes).toEqual([]);
  });

  test("emits a trace record per executed node (planner + 2 reviewers + 2 verifiers)", async () => {
    const { trace } = await runReview(diff, deps());
    const byType = trace.reduce<Record<string, number>>((m, r) => ({ ...m, [r.type]: (m[r.type] ?? 0) + 1 }), {});
    expect(byType["planner"]).toBe(1);
    expect(byType["reviewer"]).toBe(2);
    expect(byType["verifier"]).toBe(2);
    expect(trace.every((r) => r.runId === "run-test")).toBe(true);
  });

  test("reports cost from token usage", async () => {
    const { report } = await runReview(diff, deps());
    expect(report.cost.inputTokens).toBeGreaterThan(0);
    expect(report.cost.outputTokens).toBeGreaterThan(0);
    expect(report.cost.usd).toBeGreaterThan(0);
  });
});

describe("runReview — partial failure", () => {
  test("a failing reviewer yields Run=Partial with a report still produced", async () => {
    const provider = scripted({ failOn: (req) => req.role === "reviewer" && req.system.includes("security") });
    const { report } = await runReview(diff, { ...deps(), provider });
    expect(report.runStatus).toBe("partial");
    expect(report.failedNodes.some((n) => n.type === "reviewer" && n.concern === "security")).toBe(true);
    // the correctness finding survives on high severity (votes drop to 1)
    expect(report.findings.some((f) => f.concern === "correctness")).toBe(true);
  });

  test("a failing verifier keeps its finding flagged unverified (lose a bug > silence)", async () => {
    const provider = scripted({ failOn: (req) => req.role === "verifier" });
    const { report } = await runReview(diff, { ...deps(), provider });
    expect(report.runStatus).toBe("partial");
    expect(report.findings.every((f) => f.verdict.unverified)).toBe(true);
    expect(report.findings.every((f) => f.keptBy.includes("unverified-fallback"))).toBe(true);
  });
});

describe("runReview — degraded", () => {
  test("a failing planner produces a degraded report, not a crash", async () => {
    const provider = scripted({ failOn: (req) => req.role === "planner" });
    const { report } = await runReview(diff, { ...deps(), provider });
    expect(report.runStatus).toBe("partial");
    expect(report.findings).toEqual([]);
    expect(report.failedNodes.some((n) => n.type === "planner")).toBe(true);
  });
});
