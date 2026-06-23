import { z } from "zod";
import { Concern } from "./common.ts";
import { VerifiedFinding } from "./verdict.ts";

/** Whole-run outcome (see NodeStatus for the per-node lifecycle). */
export const RunStatus = z.enum(["success", "partial", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A node that didn't complete — surfaced so coverage gaps are visible. */
export const FailedNode = z
  .object({
    nodeId: z.string(),
    type: z.string(),
    concern: Concern.nullable(),
    file: z.string().nullable(),
    reason: z.string(),
  })
  .strict();
export type FailedNode = z.infer<typeof FailedNode>;

export const Cost = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    usd: z.number().min(0),
  })
  .strict();
export type Cost = z.infer<typeof Cost>;

export const DiffSummary = z
  .object({ files: z.number().int().min(0), hunks: z.number().int().min(0) })
  .strict();
export type DiffSummary = z.infer<typeof DiffSummary>;

/**
 * The pipeline's final artifact. `findings` are kept; `droppedFindings` are the
 * refuted/filtered ones, retained for transparency (you can see what the
 * verifier removed). `failedNodes` makes partial runs honest.
 */
export const ReviewReport = z
  .object({
    runId: z.string(),
    runStatus: RunStatus,
    diffSummary: DiffSummary,
    findings: z.array(VerifiedFinding),
    droppedFindings: z.array(VerifiedFinding),
    failedNodes: z.array(FailedNode),
    cost: Cost,
    latencyMs: z.number().min(0),
    tiering: z.record(z.string(), z.string()),
  })
  .strict();
export type ReviewReport = z.infer<typeof ReviewReport>;
