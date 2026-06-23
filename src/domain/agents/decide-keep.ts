import type { RawFinding } from "../schemas/finding.ts";
import type { VerifierVerdict } from "../schemas/verdict.ts";

export interface KeepConfig {
  /** Minimum verifier confidence for an upheld finding to survive. */
  readonly confidenceThreshold: number;
  /** Reviewer votes needed to keep a finding that isn't high-severity. */
  readonly voteFloor: number;
}

export interface KeepDecision {
  readonly keep: boolean;
  /** The signals that kept it (for the report's transparency), empty if dropped. */
  readonly keptBy: string[];
}

const HIGH_SEVERITY = new Set<RawFinding["severity"]>(["critical", "high"]);

/**
 * Decide whether a verified finding survives. Pure and exhaustively tested.
 *
 * Precision-biased by design (the verifier is the headline): a refuted or
 * weakly-upheld finding is dropped, and even a confidently-upheld finding needs
 * a second signal — corroboration (≥ voteFloor reviewer votes) OR high severity
 * — to survive. The recall cost of that strictness is exactly what the eval
 * reports as a separate axis, rather than hiding it. The one exception is the
 * verifier-failure fallback: if the verifier never ran, keep the finding flagged
 * `unverified` (losing a real bug is worse than a noisy line).
 */
export function decideKeep(
  verdict: VerifierVerdict,
  finding: RawFinding,
  reviewerVotes: number,
  cfg: KeepConfig,
): KeepDecision {
  if (verdict.unverified) return { keep: true, keptBy: ["unverified-fallback"] };
  if (verdict.outcome === "refuted") return { keep: false, keptBy: [] };
  if (verdict.verifierConfidence < cfg.confidenceThreshold) return { keep: false, keptBy: [] };

  const keptBy = ["verifier"];
  const corroborated = reviewerVotes >= cfg.voteFloor;
  const highSeverity = HIGH_SEVERITY.has(finding.severity);
  if (corroborated) keptBy.push(`votes>=${cfg.voteFloor}`);
  if (highSeverity) keptBy.push("high-severity");

  return corroborated || highSeverity ? { keep: true, keptBy } : { keep: false, keptBy: [] };
}
