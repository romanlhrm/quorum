import type { Severity } from "../schemas/common.ts";
import type { RawFinding } from "../schemas/finding.ts";
import type { Cost, DiffSummary, FailedNode, ReviewReport, RunStatus } from "../schemas/report.ts";
import type { VerifiedFinding, VerifierVerdict } from "../schemas/verdict.ts";
import { decideKeep, type KeepConfig } from "./decide-keep.ts";

interface Range {
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

/** Two findings overlap if they touch the same file and their line ranges intersect. */
export function overlaps(a: Range, b: Range): boolean {
  return a.file === b.file && a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function rank(s: Severity): number {
  return SEVERITY_ORDER[s] ?? SEVERITY_ORDER.info;
}

function moreSevere(a: Severity, b: Severity): Severity {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * Collapse findings that report the SAME issue: same concern + overlapping
 * lines. The survivor takes the widest range, the highest severity, the union
 * of rationales and the max confidence. Different concerns on the same lines
 * stay separate — they are genuinely different issues.
 */
export function dedupeWithinConcern(findings: RawFinding[]): RawFinding[] {
  const out: RawFinding[] = [];
  for (const finding of findings) {
    const idx = out.findIndex((o) => o.concern === finding.concern && overlaps(o, finding));
    if (idx === -1) {
      out.push(finding);
      continue;
    }
    const existing = out[idx]!;
    out[idx] = {
      ...existing,
      lineStart: Math.min(existing.lineStart, finding.lineStart),
      lineEnd: Math.max(existing.lineEnd, finding.lineEnd),
      severity: moreSevere(existing.severity, finding.severity),
      rationale: existing.rationale === finding.rationale ? existing.rationale : `${existing.rationale}\n${finding.rationale}`,
      reviewerConfidence: Math.max(existing.reviewerConfidence, finding.reviewerConfidence),
      suggestedFix: existing.suggestedFix ?? finding.suggestedFix,
    };
  }
  return out;
}

/** How many DISTINCT review concerns flag a region overlapping this finding. */
export function countVotes(finding: RawFinding, all: RawFinding[]): number {
  const concerns = new Set<string>();
  for (const other of all) {
    if (overlaps(finding, other)) concerns.add(other.concern);
  }
  return concerns.size;
}

export interface AggregateInput {
  readonly runId: string;
  readonly diffSummary: DiffSummary;
  readonly items: ReadonlyArray<{ finding: RawFinding; verdict: VerifierVerdict }>;
  readonly failedNodes: FailedNode[];
  readonly cost: Cost;
  readonly latencyMs: number;
  readonly tiering: Record<string, string>;
  readonly cfg: KeepConfig;
}

function bySeverityThenLocation(a: VerifiedFinding, b: VerifiedFinding): number {
  const s = rank(a.severity) - rank(b.severity);
  if (s !== 0) return s;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.lineStart - b.lineStart;
}

/**
 * Pure: turn verified findings into the final report. Computes each finding's
 * cross-concern vote count, applies the keep decision, splits kept vs dropped
 * (dropped retained for transparency), and derives the run status — partial if
 * any node failed, success otherwise. Never calls a model.
 */
export function aggregate(input: AggregateInput): ReviewReport {
  const all = input.items.map((i) => i.finding);
  const kept: VerifiedFinding[] = [];
  const dropped: VerifiedFinding[] = [];

  for (const { finding, verdict } of input.items) {
    const reviewerVotes = countVotes(finding, all);
    const decision = decideKeep(verdict, finding, reviewerVotes, input.cfg);
    const verified: VerifiedFinding = { ...finding, verdict, keptBy: decision.keptBy, reviewerVotes };
    (decision.keep ? kept : dropped).push(verified);
  }

  kept.sort(bySeverityThenLocation);
  dropped.sort(bySeverityThenLocation);

  const runStatus: RunStatus = input.failedNodes.length > 0 ? "partial" : "success";

  return {
    runId: input.runId,
    runStatus,
    diffSummary: input.diffSummary,
    findings: kept,
    droppedFindings: dropped,
    failedNodes: input.failedNodes,
    cost: input.cost,
    latencyMs: input.latencyMs,
    tiering: input.tiering,
  };
}
