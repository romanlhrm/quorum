import type { Role } from "../../domain/ports/llm-provider.ts";

export interface Tier {
  readonly model: string;
  readonly effort: string;
}

/**
 * Model tiering as config, not magic. The expensive, generative, hard-to-review
 * roles (planner, verifier) get the strongest model; the bounded, parallel
 * reviewer role gets a mid model; trivial routing gets the cheapest. The eval
 * reports cost so this tradeoff is legible rather than asserted.
 *
 * Pinned IDs (as of build, 2026-06): the latest Claude family.
 */
export const TIERS: Readonly<Record<Role, Tier>> = {
  planner: { model: "claude-opus-4-8", effort: "high" },
  verifier: { model: "claude-opus-4-8", effort: "high" },
  reviewer: { model: "claude-sonnet-4-6", effort: "medium" },
  router: { model: "claude-haiku-4-5-20251001", effort: "low" },
};

export function resolveTier(role: Role): Tier {
  return TIERS[role];
}
