import { z } from "zod";
import { Concern, Severity } from "./common.ts";

/**
 * One finding as the model returns it (LLM-boundary contract). It is LEAN on
 * purpose: the reviewer is already invoked per (file, hunk, concern), so the
 * model must NOT echo those back — the code attaches `id`, `concern` and `file`
 * from the task. Line numbers refer to the NEW file.
 */
export const ReviewerFinding = z
  .object({
    lineStart: z.number().int().min(1),
    lineEnd: z.number().int().min(1),
    severity: Severity,
    title: z.string(),
    rationale: z.string(),
    suggestedFix: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine((f) => f.lineStart <= f.lineEnd, { message: "lineStart must be <= lineEnd" });
export type ReviewerFinding = z.infer<typeof ReviewerFinding>;

/** The reviewer's full output: zero or more findings. */
export const ReviewerOutput = z.object({ findings: z.array(ReviewerFinding) }).strict();
export type ReviewerOutput = z.infer<typeof ReviewerOutput>;

/**
 * A finding after the code has attached identity + provenance. This is the
 * domain handoff between reviewers and the verifier/aggregator (not an LLM
 * contract). `reviewerConfidence` is the model's `confidence`, renamed for
 * clarity once it leaves the boundary.
 */
export const RawFinding = z
  .object({
    id: z.string(),
    concern: Concern,
    file: z.string(),
    lineStart: z.number().int().min(1),
    lineEnd: z.number().int().min(1),
    severity: Severity,
    title: z.string(),
    rationale: z.string(),
    suggestedFix: z.string().nullable(),
    reviewerConfidence: z.number().min(0).max(1),
  })
  .strict();
export type RawFinding = z.infer<typeof RawFinding>;
