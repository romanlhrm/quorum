import type { Diff } from "../diff/diff.types.ts";
import { renderHunkWindow } from "../diff/render-hunk.ts";
import type { LLMProvider } from "../ports/llm-provider.ts";
import { PlannerOutput, type ReviewTask } from "../schemas/review-plan.ts";

const PLANNER_SYSTEM =
  "You are the planner in a multi-agent code review. For each changed hunk you decide WHICH review " +
  "concerns genuinely warrant a specialist pass. The concerns are: correctness, security, performance, " +
  "maintainability. Be selective — do NOT default to all four. A pure-formatting hunk may need none; a " +
  "hunk touching auth needs security; a tight loop needs performance. Choosing well is the point.";

interface EnumeratedHunk {
  readonly file: string;
  readonly hunkIndex: number;
  readonly window: string;
}

function enumerateHunks(diff: Diff): EnumeratedHunk[] {
  const out: EnumeratedHunk[] = [];
  for (const file of diff.files) {
    if (file.binary) continue;
    const path = file.newPath ?? file.oldPath ?? "(unknown)";
    file.hunks.forEach((hunk, hunkIndex) => {
      out.push({ file: path, hunkIndex, window: renderHunkWindow(path, hunk) });
    });
  }
  return out;
}

function buildPrompt(hunks: EnumeratedHunk[]): string {
  const blocks = hunks
    .map((h) => `### file="${h.file}" hunkIndex=${h.hunkIndex}\n${h.window}`)
    .join("\n\n");
  return (
    `${blocks}\n\n` +
    "For each hunk above, return the concerns that genuinely warrant review and a one-line reason. " +
    "Reference `file` and `hunkIndex` exactly as shown. Omit a hunk entirely if no concern applies."
  );
}

/**
 * Decompose a diff into review tasks. The planner picks the applicable concerns
 * PER hunk (variable topology), and the code expands each (hunk × concern) into
 * one task with a deterministic id. Items referencing a hunk that does not exist
 * are dropped defensively.
 */
export async function plan(diff: Diff, provider: LLMProvider, opts: { maxTokens?: number } = {}): Promise<ReviewTask[]> {
  const hunks = enumerateHunks(diff);
  if (hunks.length === 0) return [];

  const result = await provider.complete(
    { role: "planner", system: PLANNER_SYSTEM, user: buildPrompt(hunks), maxTokens: opts.maxTokens ?? 4096 },
    PlannerOutput,
  );

  const known = new Set(hunks.map((h) => `${h.file}#${h.hunkIndex}`));
  const tasks: ReviewTask[] = [];
  for (const item of result.parsed.items) {
    if (!known.has(`${item.file}#${item.hunkIndex}`)) continue;
    for (const concern of item.concerns) {
      tasks.push({ id: `t:${item.file}#${item.hunkIndex}:${concern}`, file: item.file, hunkIndex: item.hunkIndex, concern });
    }
  }
  return tasks;
}
