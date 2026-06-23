import type { FindingLike, MatchResult } from "./matcher.ts";

export interface CaseScore {
  readonly defects: number;
  readonly findings: number;
  readonly tp: number;
  readonly fp: number;
  readonly missed: number;
  /** True positives / planted defects (1 when there are no defects to find). */
  readonly recall: number;
  /** True positives / findings reported (1 when nothing was reported). */
  readonly precision: number;
}

export function scoreCase<F extends FindingLike>(match: MatchResult<F>, defectCount: number, findingCount: number): CaseScore {
  const tp = match.matched.length;
  const fp = match.falsePositives.length;
  return {
    defects: defectCount,
    findings: findingCount,
    tp,
    fp,
    missed: match.missed.length,
    recall: defectCount === 0 ? 1 : tp / defectCount,
    precision: findingCount === 0 ? 1 : tp / findingCount,
  };
}

export interface AggregateScore {
  readonly defects: number;
  readonly findings: number;
  readonly tp: number;
  readonly fp: number;
  readonly missed: number;
  readonly recall: number;
  readonly precision: number;
  /** False positives / all findings reported — the noise rate. */
  readonly falsePositiveRate: number;
}

/** Pool case scores into corpus-level metrics. */
export function aggregateScores(cases: CaseScore[]): AggregateScore {
  const sum = (pick: (c: CaseScore) => number): number => cases.reduce((n, c) => n + pick(c), 0);
  const defects = sum((c) => c.defects);
  const findings = sum((c) => c.findings);
  const tp = sum((c) => c.tp);
  const fp = sum((c) => c.fp);
  return {
    defects,
    findings,
    tp,
    fp,
    missed: sum((c) => c.missed),
    recall: defects === 0 ? 1 : tp / defects,
    precision: findings === 0 ? 1 : tp / findings,
    falsePositiveRate: findings === 0 ? 0 : fp / findings,
  };
}
