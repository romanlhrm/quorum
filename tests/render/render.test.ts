import { describe, expect, test } from "bun:test";
import { aggregate } from "../../src/domain/agents/aggregate.ts";
import { renderReportMarkdown } from "../../src/render/report-markdown.ts";
import { renderTraceSummary } from "../../src/render/trace-summary.ts";
import type { RawFinding } from "../../src/domain/schemas/finding.ts";
import type { TraceRecord } from "../../src/domain/schemas/trace.ts";
import type { VerifierVerdict } from "../../src/domain/schemas/verdict.ts";

function finding(id: string, severity: RawFinding["severity"], line: number): RawFinding {
  return { id, concern: "security", file: "src/api.ts", lineStart: line, lineEnd: line, severity, title: `Issue ${id}`, rationale: "because", suggestedFix: "fix it", reviewerConfidence: 0.9 };
}
function verdict(id: string, outcome: VerifierVerdict["outcome"]): VerifierVerdict {
  return { findingId: id, outcome, verifierConfidence: 0.85, reasoning: "judged", unverified: false };
}

const report = aggregate({
  runId: "run-xyz",
  diffSummary: { files: 1, hunks: 2 },
  items: [
    { finding: finding("k1", "critical", 10), verdict: verdict("k1", "upheld") },
    { finding: finding("d1", "high", 80), verdict: verdict("d1", "refuted") },
  ],
  failedNodes: [{ nodeId: "r:perf", type: "reviewer", concern: "performance", file: "src/api.ts", reason: "timeout" }],
  cost: { inputTokens: 1200, outputTokens: 340, usd: 0.0123 },
  latencyMs: 4567,
  tiering: { planner: "claude-opus-4-8", reviewer: "claude-sonnet-4-6" },
  cfg: { confidenceThreshold: 0.6, voteFloor: 2 },
});

describe("renderReportMarkdown", () => {
  const md = renderReportMarkdown(report);

  test("headlines run id and partial status (a node failed)", () => {
    expect(md).toContain("run-xyz");
    expect(md.toLowerCase()).toContain("partial");
  });

  test("shows the kept finding with location, title and provenance", () => {
    expect(md).toContain("src/api.ts:10");
    expect(md).toContain("Issue k1");
    expect(md).toContain("verifier");
  });

  test("shows what the verifier dropped, for transparency", () => {
    expect(md).toContain("Issue d1");
    expect(md.toLowerCase()).toContain("refuted");
  });

  test("surfaces the coverage gap from the failed reviewer", () => {
    expect(md.toLowerCase()).toContain("performance");
    expect(md).toContain("timeout");
  });

  test("reports cost and latency", () => {
    expect(md).toContain("1200");
    expect(md).toContain("4567");
  });
});

describe("renderTraceSummary", () => {
  const trace: TraceRecord[] = [
    { runId: "r", nodeId: "planner", type: "planner", parentNodeIds: [], concern: null, target: null, model: "claude-opus-4-8", effort: null, inputSummary: "2 hunks", outputSummary: "3 tasks", tokens: { input: 500, output: 80 }, latencyMs: 900, attempts: 1, status: "success", error: null, startedAt: 0, endedAt: 900, providerMode: "replay" },
    { runId: "r", nodeId: "v:f1", type: "verifier", parentNodeIds: ["t:a"], concern: "security", target: { file: "a.ts", hunkIndex: 0 }, model: "claude-opus-4-8", effort: null, inputSummary: "Issue", outputSummary: "refuted", tokens: { input: 200, output: 30 }, latencyMs: 400, attempts: 1, status: "success", error: null, startedAt: 900, endedAt: 1300, providerMode: "replay" },
  ];

  test("renders one readable line per node with type, status and model", () => {
    const out = renderTraceSummary(trace);
    expect(out).toContain("planner");
    expect(out).toContain("verifier");
    expect(out).toContain("claude-opus-4-8");
    expect(out.split("\n").filter((l) => l.trim().length > 0).length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderReportMarkdown groups the same issue seen by two concerns", () => {
  const sqli = (id: string, concern: RawFinding["concern"], title: string): RawFinding => ({
    ...finding(id, "critical", 11),
    concern,
    title,
  });
  const twoLens = aggregate({
    runId: "run-dup",
    diffSummary: { files: 1, hunks: 1 },
    items: [
      { finding: sqli("s1", "security", "SQL Injection via string concatenation"), verdict: verdict("s1", "upheld") },
      { finding: sqli("s2", "correctness", "SQL injection via string concatenation"), verdict: verdict("s2", "upheld") },
      { finding: { ...finding("n1", "high", 15), concern: "correctness", title: "Null dereference" }, verdict: verdict("n1", "upheld") },
    ],
    failedNodes: [],
    cost: { inputTokens: 1, outputTokens: 1, usd: 0 },
    latencyMs: 1,
    tiering: {},
    cfg: { confidenceThreshold: 0.6, voteFloor: 2 },
  });
  const md = renderReportMarkdown(twoLens);

  test("pipeline still keeps both findings (each concern is a vote)", () => {
    expect(twoLens.findings.length).toBe(3);
  });

  test("report shows the SQL injection once, naming both concerns", () => {
    expect(md.match(/^### /gm)?.length).toBe(2);
    expect(md).toContain("security + correctness");
    expect(md).toContain("2 issues, from 3 kept findings");
  });
});
