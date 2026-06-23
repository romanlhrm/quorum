export interface Rate {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

/**
 * Approximate per-million-token USD rates, as of the build date (2026-06). These
 * exist so the eval can compare cost RELATIVELY (e.g. verifier on vs off); treat
 * the absolute USD as indicative and refresh before relying on it. An unknown
 * model contributes 0 rather than guessing.
 */
export const PRICING: Record<string, Rate> = {
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 0.8, outputPerMTok: 4 },
};

export function usdFor(model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING[model];
  if (!rate) return 0;
  return (inputTokens / 1_000_000) * rate.inputPerMTok + (outputTokens / 1_000_000) * rate.outputPerMTok;
}
