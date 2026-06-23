import { decideKeep, type KeepConfig } from "../domain/agents/decide-keep.ts";
import type { Diff } from "../domain/diff/diff.types.ts";
import { runReview, type ReviewDeps } from "../domain/orchestrator.ts";
import type { TruthManifest } from "../domain/schemas/eval.ts";
import type { VerifiedFinding } from "../domain/schemas/verdict.ts";
import { matchFindings } from "./matcher.ts";
import { aggregateScores, scoreCase, type AggregateScore, type CaseScore } from "./scorer.ts";

export interface EvalCase {
  readonly name: string;
  readonly diff: Diff;
  readonly truth: TruthManifest;
}

export interface EvalResult {
  /** Reviewers + isolated verifier + keep gate (the real pipeline). */
  readonly withVerifier: AggregateScore;
  /** Reviewers only — every deduped finding kept (the baseline). */
  readonly withoutVerifier: AggregateScore;
  /** Keep-threshold sweep, so the locked 0.6 reads as robust not fitted. */
  readonly sensitivity: Array<{ threshold: number; score: AggregateScore }>;
  readonly perCase: Array<{ name: string; kept: number; total: number; runStatus: string }>;
}

const THRESHOLDS = [0.5, 0.6, 0.7];

function defectCount(truth: TruthManifest): number {
  return truth.kind === "defect" ? truth.defects.length : 0;
}

function keptAt(combined: VerifiedFinding[], cfg: KeepConfig): VerifiedFinding[] {
  return combined.filter((vf) => decideKeep(vf.verdict, vf, vf.reviewerVotes, cfg).keep);
}

/**
 * Run the dataset through the real pipeline ONCE per case, then derive every
 * metric from the resulting findings: verifier-on (kept), verifier-off (all
 * deduped findings), and a keep-threshold sweep — all by re-applying the pure
 * `decideKeep`, so no extra model calls are needed.
 */
export async function runEval(
  cases: EvalCase[],
  deps: Omit<ReviewDeps, "runId">,
  tolerance: number,
): Promise<EvalResult> {
  const onScores: CaseScore[] = [];
  const offScores: CaseScore[] = [];
  const sensScores = new Map<number, CaseScore[]>(THRESHOLDS.map((t) => [t, []]));
  const perCase: EvalResult["perCase"] = [];

  for (const c of cases) {
    const { report } = await runReview(c.diff, { ...deps, runId: `eval-${c.name}` });
    const combined = [...report.findings, ...report.droppedFindings];
    const defects = defectCount(c.truth);

    const on = report.findings;
    onScores.push(scoreCase(matchFindings(on, c.truth, tolerance), defects, on.length));
    offScores.push(scoreCase(matchFindings(combined, c.truth, tolerance), defects, combined.length));

    for (const t of THRESHOLDS) {
      const kept = keptAt(combined, { confidenceThreshold: t, voteFloor: deps.cfg.voteFloor });
      sensScores.get(t)!.push(scoreCase(matchFindings(kept, c.truth, tolerance), defects, kept.length));
    }

    perCase.push({ name: c.name, kept: on.length, total: combined.length, runStatus: report.runStatus });
  }

  return {
    withVerifier: aggregateScores(onScores),
    withoutVerifier: aggregateScores(offScores),
    sensitivity: THRESHOLDS.map((t) => ({ threshold: t, score: aggregateScores(sensScores.get(t)!) })),
    perCase,
  };
}
