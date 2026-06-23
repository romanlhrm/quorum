/**
 * Bounded model of a unified `git diff`: a Diff is a list of files, each a list
 * of hunks, each a list of lines. Every line carries its resolved old/new line
 * number so a reviewer can cite an exact location in the post-change file.
 *
 * This is the ONLY thing the pipeline knows about source — there is no working
 * tree and no repo access. Reviewers see each hunk (plus its surrounding context
 * lines); whole-file and cross-file retrieval are deliberately out of scope.
 */

export type LineKind = "add" | "del" | "context";

export interface DiffLine {
  readonly kind: LineKind;
  /** Line text with the leading +/-/space marker stripped. */
  readonly content: string;
  /** 1-based line number in the OLD file, or null for added lines. */
  readonly oldLineNo: number | null;
  /** 1-based line number in the NEW file, or null for deleted lines. */
  readonly newLineNo: number | null;
}

export interface Hunk {
  /** The raw `@@ -a,b +c,d @@` line, including any trailing section heading. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  /** Path in the old tree; null for a newly added file. */
  readonly oldPath: string | null;
  /** Path in the new tree; null for a deleted file. */
  readonly newPath: string | null;
  readonly status: FileStatus;
  /** True when git reported a binary file; such files carry no hunks. */
  readonly binary: boolean;
  readonly hunks: Hunk[];
}

export interface Diff {
  readonly files: DiffFile[];
}
