import type { Hunk } from "../diff/diff.types.ts";
import { renderHunkWindow } from "../diff/render-hunk.ts";
import type { LLMProvider } from "../ports/llm-provider.ts";
import type { RawFinding } from "../schemas/finding.ts";
import { VerifierOutput, type VerifierVerdict } from "../schemas/verdict.ts";

const VERIFIER_SYSTEM =
  "You are an isolated, skeptical verifier. A reviewer has claimed a single finding about a single hunk. " +
  "Your job is to try to REFUTE it: assume it may be wrong and look for why. Uphold it ONLY if the hunk itself " +
  "clearly supports the claim. If the evidence is absent, speculative, or depends on code you cannot see, refute " +
  "it. You see nothing but this one finding and this one hunk — no other findings, no wider context.";

function buildPrompt(finding: RawFinding, hunk: Hunk): string {
  return (
    `A reviewer claims this ${finding.concern} issue:\n` +
    `  title: ${finding.title}\n` +
    `  lines: ${finding.lineStart}-${finding.lineEnd} (new file)\n` +
    `  rationale: ${finding.rationale}\n\n` +
    `The ONLY context you may use is this hunk:\n${renderHunkWindow(finding.file, hunk)}\n\n` +
    "Is the finding real and supported by THIS hunk? Try to refute it before agreeing. " +
    "Report your outcome (upheld/refuted), your confidence, and your reasoning."
  );
}

/**
 * Independently judge ONE finding against ONLY its hunk. Isolation (a fresh call
 * seeded with nothing but the single finding + single hunk) and the refute bias
 * are what remove the rubber-stamp tendency of a shared-context judge. The code
 * attaches the finding id; `unverified` is false here (it is only set true by
 * the orchestrator's fallback when this call itself fails).
 */
export async function verify(
  finding: RawFinding,
  hunk: Hunk,
  provider: LLMProvider,
  opts: { maxTokens?: number } = {},
): Promise<VerifierVerdict> {
  const result = await provider.complete(
    { role: "verifier", system: VERIFIER_SYSTEM, user: buildPrompt(finding, hunk), maxTokens: opts.maxTokens ?? 2048 },
    VerifierOutput,
  );
  return {
    findingId: finding.id,
    outcome: result.parsed.outcome,
    verifierConfidence: result.parsed.confidence,
    reasoning: result.parsed.reasoning,
    unverified: false,
  };
}
