import { z } from "zod";

/**
 * Derive a JSON Schema (draft 2020-12) from a Zod schema, for use as an
 * Anthropic tool `input_schema`. Zod is the single source of truth: the JSON
 * Schema constrains the SHAPE the model must return, while semantic checks
 * expressed via `.refine()` (which JSON Schema cannot represent) are silently
 * dropped here and enforced later by `.parse()` — that asymmetry is intentional.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
