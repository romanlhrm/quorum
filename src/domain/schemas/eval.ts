import { z } from "zod";
import { Concern, Severity } from "./common.ts";

/** A deliberately introduced defect with its ground-truth location and concern. */
export const PlantedDefect = z
  .object({
    defectId: z.string(),
    file: z.string(),
    lineStart: z.number().int().min(1),
    lineEnd: z.number().int().min(1),
    type: z.string(),
    concern: Concern,
    severity: Severity,
    note: z.string(),
  })
  .strict();
export type PlantedDefect = z.infer<typeof PlantedDefect>;

/**
 * Ground truth for an eval case. A `clean` case has no defects, so ANY finding
 * it produces is a false positive — these are the FP-bait cases that let the
 * verifier's precision gain be measured honestly.
 */
export const TruthManifest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("defect"), defects: z.array(PlantedDefect) }).strict(),
  z.object({ kind: z.literal("clean") }).strict(),
]);
export type TruthManifest = z.infer<typeof TruthManifest>;
