import { z } from "zod";
import { Concern } from "./common.ts";

/**
 * One planner decision: for a specific hunk, WHICH concerns are worth reviewing.
 * The per-hunk concern *selection* (not a fixed fan-out) is what makes the DAG
 * topology vary with the diff. `reason` keeps the planner honest and is traced.
 */
export const PlanItem = z
  .object({
    file: z.string(),
    hunkIndex: z.number().int().min(0),
    concerns: z.array(Concern).min(1),
    reason: z.string(),
  })
  .strict();
export type PlanItem = z.infer<typeof PlanItem>;

/** The planner's full output: the LLM-boundary contract. */
export const PlannerOutput = z.object({ items: z.array(PlanItem) }).strict();
export type PlannerOutput = z.infer<typeof PlannerOutput>;

/**
 * A single (hunk × concern) unit of review work, expanded from the plan in code
 * and carried by one reviewer node in the DAG. Not an LLM contract.
 */
export const ReviewTask = z
  .object({
    id: z.string(),
    file: z.string(),
    hunkIndex: z.number().int().min(0),
    concern: Concern,
  })
  .strict();
export type ReviewTask = z.infer<typeof ReviewTask>;
