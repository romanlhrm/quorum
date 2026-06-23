import { z } from "zod";
import { Concern } from "./common.ts";

export const NodeType = z.enum(["planner", "reviewer", "verifier", "aggregator"]);
export type NodeType = z.infer<typeof NodeType>;

export const TraceStatus = z.enum(["success", "partial", "failed", "blocked"]);
export type TraceStatus = z.infer<typeof TraceStatus>;

/**
 * One row of the per-node execution trace, written as JSONL. Everything an
 * inspector needs to understand a run: the node, its logical parents, what it
 * looked at, which model ran it, tokens, timing, status, and the provider mode
 * (so a reader knows whether the numbers came from a live call or replay).
 */
export const TraceRecord = z
  .object({
    runId: z.string(),
    nodeId: z.string(),
    type: NodeType,
    parentNodeIds: z.array(z.string()),
    concern: Concern.nullable(),
    target: z.object({ file: z.string(), hunkIndex: z.number().int().min(0) }).strict().nullable(),
    model: z.string().nullable(),
    effort: z.string().nullable(),
    inputSummary: z.string(),
    outputSummary: z.string(),
    tokens: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }).strict().nullable(),
    latencyMs: z.number().min(0),
    attempts: z.number().int().min(0),
    status: TraceStatus,
    error: z.string().nullable(),
    startedAt: z.number().int(),
    endedAt: z.number().int(),
    providerMode: z.enum(["live", "replay", "record"]),
  })
  .strict();
export type TraceRecord = z.infer<typeof TraceRecord>;
