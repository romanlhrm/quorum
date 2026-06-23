import { describe, expect, test } from "bun:test";
import { decideKeep, type KeepConfig } from "../../src/domain/agents/decide-keep.ts";
import type { RawFinding } from "../../src/domain/schemas/finding.ts";
import type { VerifierVerdict } from "../../src/domain/schemas/verdict.ts";

const cfg: KeepConfig = { confidenceThreshold: 0.6, voteFloor: 2 };

function finding(severity: RawFinding["severity"]): RawFinding {
  return {
    id: "f1",
    concern: "correctness",
    file: "a.ts",
    lineStart: 10,
    lineEnd: 12,
    severity,
    title: "t",
    rationale: "r",
    suggestedFix: null,
    reviewerConfidence: 0.7,
  };
}

function verdict(outcome: VerifierVerdict["outcome"], confidence: number, unverified = false): VerifierVerdict {
  return { findingId: "f1", outcome, verifierConfidence: confidence, reasoning: "x", unverified };
}

describe("decideKeep", () => {
  test("verifier-failure fallback keeps the finding flagged unverified", () => {
    const d = decideKeep(verdict("refuted", 0, true), finding("low"), 1, cfg);
    expect(d.keep).toBe(true);
    expect(d.keptBy).toEqual(["unverified-fallback"]);
  });

  test("a refuted finding is dropped", () => {
    expect(decideKeep(verdict("refuted", 0.9), finding("high"), 5, cfg).keep).toBe(false);
  });

  test("an upheld finding below the confidence threshold is dropped", () => {
    expect(decideKeep(verdict("upheld", 0.5), finding("high"), 5, cfg).keep).toBe(false);
  });

  test("upheld + confident + enough votes is kept and records why", () => {
    const d = decideKeep(verdict("upheld", 0.8), finding("medium"), 2, cfg);
    expect(d.keep).toBe(true);
    expect(d.keptBy).toContain("verifier");
    expect(d.keptBy).toContain("votes>=2");
  });

  test("upheld + confident + a single high-severity vote is kept on severity", () => {
    const d = decideKeep(verdict("upheld", 0.8), finding("critical"), 1, cfg);
    expect(d.keep).toBe(true);
    expect(d.keptBy).toContain("high-severity");
  });

  test("upheld + confident but a single low-severity vote is dropped as noise", () => {
    const d = decideKeep(verdict("upheld", 0.8), finding("medium"), 1, cfg);
    expect(d.keep).toBe(false);
    expect(d.keptBy).toEqual([]);
  });
});
