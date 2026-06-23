import { describe, expect, test } from "bun:test";
import { matchFindings, type FindingLike } from "../../src/eval/matcher.ts";
import { aggregateScores, scoreCase } from "../../src/eval/scorer.ts";
import type { Concern } from "../../src/domain/schemas/common.ts";
import type { PlantedDefect, TruthManifest } from "../../src/domain/schemas/eval.ts";

function fl(concern: Concern, lineStart: number, lineEnd: number, file = "a.ts"): FindingLike {
  return { file, concern, lineStart, lineEnd };
}
function defect(concern: Concern, lineStart: number, lineEnd: number, file = "a.ts"): PlantedDefect {
  return { defectId: `${concern}-${lineStart}`, file, lineStart, lineEnd, type: "x", concern, severity: "high", note: "" };
}

describe("matchFindings", () => {
  const tolerance = 3;

  test("every finding in a CLEAN case is a false positive", () => {
    const truth: TruthManifest = { kind: "clean" };
    const r = matchFindings([fl("security", 5, 5), fl("performance", 9, 9)], truth, tolerance);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(0);
    expect(r.falsePositives).toHaveLength(2);
  });

  test("a finding within tolerance and same concern matches the defect", () => {
    const truth: TruthManifest = { kind: "defect", defects: [defect("correctness", 10, 10)] };
    const r = matchFindings([fl("correctness", 12, 12)], truth, tolerance); // 12 within 10±3
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(0);
    expect(r.falsePositives).toHaveLength(0);
  });

  test("a right-location finding with the WRONG concern does not match", () => {
    const truth: TruthManifest = { kind: "defect", defects: [defect("correctness", 10, 10)] };
    const r = matchFindings([fl("performance", 10, 10)], truth, tolerance);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(1); // defect unmatched
    expect(r.falsePositives).toHaveLength(1); // the off-concern finding
  });

  test("a far-away finding is a false positive and the defect is missed", () => {
    const truth: TruthManifest = { kind: "defect", defects: [defect("security", 10, 10)] };
    const r = matchFindings([fl("security", 50, 50)], truth, tolerance);
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(1);
    expect(r.falsePositives).toHaveLength(1);
  });

  test("one finding cannot match two defects (greedy one-to-one)", () => {
    const truth: TruthManifest = { kind: "defect", defects: [defect("correctness", 10, 10), defect("correctness", 11, 11)] };
    const r = matchFindings([fl("correctness", 10, 11)], truth, tolerance);
    expect(r.matched).toHaveLength(1);
    expect(r.missed).toHaveLength(1);
  });
});

describe("scoreCase + aggregateScores", () => {
  test("recall and precision from a defect case", () => {
    const truth: TruthManifest = { kind: "defect", defects: [defect("correctness", 10, 10), defect("security", 20, 20)] };
    const findings = [fl("correctness", 10, 10), fl("performance", 99, 99)]; // 1 tp, 1 fp, 1 missed
    const s = scoreCase(matchFindings(findings, truth, 3), 2, findings.length);
    expect(s.tp).toBe(1);
    expect(s.fp).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.recall).toBeCloseTo(0.5);
    expect(s.precision).toBeCloseTo(0.5);
  });

  test("a clean case with no findings scores perfect precision and recall", () => {
    const s = scoreCase(matchFindings([], { kind: "clean" }, 3), 0, 0);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.fp).toBe(0);
  });

  test("aggregate pools counts across cases", () => {
    const a = scoreCase(matchFindings([fl("correctness", 10, 10)], { kind: "defect", defects: [defect("correctness", 10, 10)] }, 3), 1, 1);
    const b = scoreCase(matchFindings([fl("security", 5, 5)], { kind: "clean" }, 3), 0, 1);
    const agg = aggregateScores([a, b]);
    expect(agg.defects).toBe(1);
    expect(agg.tp).toBe(1);
    expect(agg.fp).toBe(1); // the clean case's lone finding
    expect(agg.recall).toBeCloseTo(1);
    expect(agg.falsePositiveRate).toBeCloseTo(0.5); // 1 fp / 2 findings
  });
});
