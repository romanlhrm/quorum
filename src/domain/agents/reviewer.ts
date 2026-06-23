import type { Hunk } from "../diff/diff.types.ts";
import { renderHunkWindow } from "../diff/render-hunk.ts";
import type { Concern } from "../schemas/common.ts";
import type { LLMProvider } from "../ports/llm-provider.ts";
import { ReviewerOutput, type RawFinding } from "../schemas/finding.ts";
import type { ReviewTask } from "../schemas/review-plan.ts";
import { CONCERN_RUBRICS } from "./rubrics.ts";

function reviewerSystem(concern: Concern): string {
  return (
    `You are a senior code reviewer specialising in ${concern}. ${CONCERN_RUBRICS[concern]}\n\n` +
    `Report ONLY ${concern} issues, and only ones actually present in the changed lines of the hunk you are given. ` +
    "Cite NEW-file line numbers. If there are none, return an empty list — do not invent issues to seem thorough. " +
    "Set confidence honestly: how sure are you this is a real issue?"
  );
}

/**
 * Review one (hunk × concern) task. One class, parameterised by concern — the
 * code attaches identity (`id`, `concern`, `file`) so the model never has to
 * echo them back. Line numbers refer to the new file.
 */
export async function review(
  task: ReviewTask,
  hunk: Hunk,
  provider: LLMProvider,
  opts: { maxTokens?: number } = {},
): Promise<RawFinding[]> {
  const result = await provider.complete(
    {
      role: "reviewer",
      system: reviewerSystem(task.concern),
      user: `${renderHunkWindow(task.file, hunk)}\n\nReport ${task.concern} issues in the changed lines above.`,
      maxTokens: opts.maxTokens ?? 4096,
    },
    ReviewerOutput,
  );

  return result.parsed.findings.map((f, i) => ({
    id: `${task.id}#${i}`,
    concern: task.concern,
    file: task.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    severity: f.severity,
    title: f.title,
    rationale: f.rationale,
    suggestedFix: f.suggestedFix,
    reviewerConfidence: f.confidence,
  }));
}
