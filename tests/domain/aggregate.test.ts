import { describe, expect, test } from "bun:test";
import { aggregate, countVotes, dedupeWithinConcern, overlaps } from "../../src/domain/agents/aggregate.ts";
import type { AggregateInput } from "../../src/domain/agents/aggregate.ts";
import type { Concern, Severity } from "../../src/domain/schemas/common.ts";
import type { RawFinding } from "../../src/domain/schemas/finding.ts";
import type { VerifierVerdict } from "../../src/domain/schemas/verdict.ts";

function f(id: string, concern: Concern, lineStart: number, lineEnd: number, severity: Severity = "medium"): RawFinding {
  return { id, concern, file: "a.ts", lineStart, lineEnd, severity, title: id, rationale: "r", suggestedFix: null, reviewerConfidence: 0.8 };
}
function v(findingId: string, outcome: VerifierVerdict["outcome"], confidence = 0.9, unverified = false): VerifierVerdict {
  return { findingId, outcome, verifierConfidence: confidence, reasoning: "x", unverified };
}

describe("overlaps", () => {
  test("true when same file and line ranges intersect", () => {
    expect(overlaps(f("a", "correctness", 10, 12), f("b", "security", 11, 20))).toBe(true);
  });
  test("false for disjoint ranges", () => {
    expect(overlaps(f("a", "correctness", 10, 12), f("b", "security", 13, 20))).toBe(false);
  });
  test("false across different files", () => {
    const other = { ...f("b", "security", 10, 12), file: "b.ts" };
    expect(overlaps(f("a", "correctness", 10, 12), other)).toBe(false);
  });
});

describe("dedupeWithinConcern", () => {
  test("collapses overlapping same-concern findings, keeping the highest severity", () => {
    const out = dedupeWithinConcern([f("a", "correctness", 10, 12, "low"), f("b", "correctness", 11, 13, "high")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("high");
  });
  test("keeps different concerns on the same lines separate", () => {
    const out = dedupeWithinConcern([f("a", "correctness", 10, 12), f("b", "security", 10, 12)]);
    expect(out).toHaveLength(2);
  });
});

describe("countVotes", () => {
  test("counts distinct concerns overlapping a finding, including its own", () => {
    const all = [f("a", "correctness", 10, 12), f("b", "security", 11, 13), f("c", "performance", 50, 50)];
    expect(countVotes(all[0]!, all)).toBe(2); // correctness + security overlap at ~11
    expect(countVotes(all[2]!, all)).toBe(1); // performance alone
  });
});

describe("aggregate", () => {
  const base: Omit<AggregateInput, "items" | "failedNodes"> = {
    runId: "run1",
    diffSummary: { files: 1, hunks: 1 },
    cost: { inputTokens: 100, outputTokens: 20, usd: 0.01 },
    latencyMs: 1234,
    tiering: { planner: "claude-opus-4-8" },
    cfg: { confidenceThreshold: 0.6, voteFloor: 2 },
  };

  const items = [
    { finding: f("f1", "correctness", 10, 12), verdict: v("f1", "upheld") }, // corroborated by f2 -> kept
    { finding: f("f2", "security", 11, 13), verdict: v("f2", "upheld") }, // corroborated by f1 -> kept
    { finding: f("f3", "performance", 50, 50, "low"), verdict: v("f3", "upheld") }, // lone low -> dropped
    { finding: f("f4", "correctness", 80, 80, "high"), verdict: v("f4", "refuted") }, // refuted -> dropped
    { finding: f("f5", "maintainability", 90, 90, "critical"), verdict: v("f5", "upheld") }, // high sev -> kept
  ];

  test("keeps corroborated and high-severity verified findings, drops the rest", () => {
    const report = aggregate({ ...base, items, failedNodes: [] });
    expect(report.findings.map((x) => x.id).sort()).toEqual(["f1", "f2", "f5"]);
    expect(report.droppedFindings.map((x) => x.id).sort()).toEqual(["f3", "f4"]);
  });

  test("annotates kept findings with their vote count and keptBy", () => {
    const report = aggregate({ ...base, items, failedNodes: [] });
    const f1 = report.findings.find((x) => x.id === "f1")!;
    expect(f1.reviewerVotes).toBe(2);
    expect(f1.keptBy).toContain("verifier");
  });

  test("run status is success with no failed nodes, partial otherwise", () => {
    expect(aggregate({ ...base, items, failedNodes: [] }).runStatus).toBe("success");
    const withFail = aggregate({
      ...base,
      items,
      failedNodes: [{ nodeId: "n", type: "reviewer", concern: "security", file: "a.ts", reason: "timeout" }],
    });
    expect(withFail.runStatus).toBe("partial");
  });

  test("the produced report validates against the ReviewReport schema", async () => {
    const { ReviewReport } = await import("../../src/domain/schemas/report.ts");
    const report = aggregate({ ...base, items, failedNodes: [] });
    expect(ReviewReport.safeParse(report).success).toBe(true);
  });
});
