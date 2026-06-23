import type { Concern } from "../domain/schemas/common.ts";
import type { PlantedDefect, TruthManifest } from "../domain/schemas/eval.ts";

/** The minimum a finding must expose to be matched against ground truth. */
export interface FindingLike {
  readonly file: string;
  readonly concern: Concern;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface MatchResult<F extends FindingLike> {
  readonly matched: Array<{ defect: PlantedDefect; finding: F }>;
  readonly missed: PlantedDefect[];
  readonly falsePositives: F[];
}

function matchesDefect(f: FindingLike, d: PlantedDefect, tolerance: number): boolean {
  return (
    f.file === d.file &&
    f.concern === d.concern &&
    f.lineStart - tolerance <= d.lineEnd &&
    d.lineStart <= f.lineEnd + tolerance
  );
}

/**
 * Match findings against ground truth: a defect matches a finding of the same
 * file + concern whose line range is within ±tolerance (defect TYPE is
 * informational, not required). Greedy one-to-one — a finding can satisfy at
 * most one defect. In a clean case there are no defects, so every finding is a
 * false positive.
 */
export function matchFindings<F extends FindingLike>(findings: F[], truth: TruthManifest, tolerance: number): MatchResult<F> {
  if (truth.kind === "clean") {
    return { matched: [], missed: [], falsePositives: [...findings] };
  }

  const used = new Set<F>();
  const matched: Array<{ defect: PlantedDefect; finding: F }> = [];
  const missed: PlantedDefect[] = [];

  for (const defect of truth.defects) {
    const finding = findings.find((f) => !used.has(f) && matchesDefect(f, defect, tolerance));
    if (finding) {
      used.add(finding);
      matched.push({ defect, finding });
    } else {
      missed.push(defect);
    }
  }

  return { matched, missed, falsePositives: findings.filter((f) => !used.has(f)) };
}
