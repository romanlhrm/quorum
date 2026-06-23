import { z } from "zod";
import { Outcome } from "./common.ts";
import { RawFinding } from "./finding.ts";

/**
 * The verifier's judgement on ONE finding (LLM-boundary contract). The verifier
 * is run in isolation — seeded only with the single hunk + the single finding —
 * and is prompted to refute; the code attaches `findingId`.
 */
export const VerifierOutput = z
  .object({
    outcome: Outcome,
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  })
  .strict();
export type VerifierOutput = z.infer<typeof VerifierOutput>;

/** A verdict after the code attaches identity + the failure-fallback flag. */
export const VerifierVerdict = z
  .object({
    findingId: z.string(),
    outcome: Outcome,
    verifierConfidence: z.number().min(0).max(1),
    reasoning: z.string(),
    /** True when the verifier itself failed and we kept the finding anyway. */
    unverified: z.boolean(),
  })
  .strict();
export type VerifierVerdict = z.infer<typeof VerifierVerdict>;

/** A finding plus its verdict and the keep decision's provenance. */
export const VerifiedFinding = RawFinding.extend({
  verdict: VerifierVerdict,
  /** Which signals kept it: e.g. "verifier", "high-severity", "votes>=2". */
  keptBy: z.array(z.string()),
  /** How many reviewers independently raised an overlapping finding. */
  reviewerVotes: z.number().int().min(1),
}).strict();
export type VerifiedFinding = z.infer<typeof VerifiedFinding>;
