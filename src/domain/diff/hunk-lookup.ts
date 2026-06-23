import type { Diff, DiffFile, Hunk } from "./diff.types.ts";

function fileByPath(diff: Diff, path: string): DiffFile | undefined {
  return diff.files.find((f) => (f.newPath ?? f.oldPath) === path);
}

/** The nth hunk of a file (as the planner enumerated them). */
export function hunkByIndex(diff: Diff, path: string, hunkIndex: number): Hunk | undefined {
  return fileByPath(diff, path)?.hunks[hunkIndex];
}

/**
 * The hunk a finding refers to: prefer the hunk whose lines include the cited
 * new-file line, fall back to the hunk whose new range covers it, then to the
 * file's first hunk. Lets the verifier be handed exactly the window the finding
 * lives in.
 */
export function hunkContainingNewLine(diff: Diff, path: string, line: number): Hunk | undefined {
  const file = fileByPath(diff, path);
  if (!file) return undefined;
  return (
    file.hunks.find((h) => h.lines.some((l) => l.newLineNo === line)) ??
    file.hunks.find((h) => line >= h.newStart && line < h.newStart + h.newLines) ??
    file.hunks[0]
  );
}
