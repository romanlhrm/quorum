import type { z } from "zod";
import type { LlmRequest } from "../../domain/ports/llm-provider.ts";
import { toJsonSchema } from "../../domain/schemas/to-json-schema.ts";
import { requestHash, type ResolvedRequest } from "./request-hash.ts";
import { resolveTier } from "./tier-config.ts";

/**
 * Resolve a role-based request into the concrete (model, effort, schemaJson)
 * form and its content hash. Shared by the replay reader and the recorder so
 * both compute the IDENTICAL fixture key from the IDENTICAL inputs.
 */
export function resolveRequest(req: LlmRequest, schema: z.ZodType): { resolved: ResolvedRequest; hash: string } {
  const tier = resolveTier(req.role);
  const resolved: ResolvedRequest = {
    model: tier.model,
    effort: tier.effort,
    maxTokens: req.maxTokens,
    system: req.system,
    user: req.user,
    schemaJson: toJsonSchema(schema),
  };
  return { resolved, hash: requestHash(resolved) };
}
