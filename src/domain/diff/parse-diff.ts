import type { Diff, DiffFile, DiffLine, FileStatus, Hunk } from "./diff.types.ts";

const FILE_HEADER = /^diff --git /;
const GIT_PATHS = /^diff --git a\/(\S+) b\/(\S+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Strip a leading `a/` or `b/` git prefix; map `/dev/null` to null. */
function cleanPath(raw: string): string | null {
  const path = raw.trim();
  if (path === "/dev/null") return null;
  if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
  return path;
}

/**
 * Parse a single unified `git diff` string into the bounded Diff model.
 * Pure: no fs, no working tree, no network.
 */
export function parseDiff(raw: string): Diff {
  const lines = raw.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const files: DiffFile[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!FILE_HEADER.test(lines[i]!)) {
      i++;
      continue;
    }
    const { file, next } = parseFile(lines, i);
    files.push(file);
    i = next;
  }

  return { files };
}

function parseFile(lines: string[], start: number): { file: DiffFile; next: number } {
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let status: FileStatus = "modified";
  let binary = false;
  const hunks: Hunk[] = [];

  // Seed paths from the `diff --git a/X b/Y` line (the only source for binary
  // files, which carry no ---/+++). Assumes unquoted, space-free paths; the
  // ---/+++ and rename lines below override with the authoritative value
  // (e.g. /dev/null for an add/delete).
  const gitPaths = GIT_PATHS.exec(lines[start]!);
  if (gitPaths) {
    oldPath = gitPaths[1]!;
    newPath = gitPaths[2]!;
  }

  let i = start + 1; // skip the `diff --git` line itself
  // Header section: everything up to the first hunk or the next file.
  while (i < lines.length) {
    const line = lines[i]!;
    if (FILE_HEADER.test(line) || HUNK_HEADER.test(line)) break;

    if (line.startsWith("new file mode")) status = "added";
    else if (line.startsWith("deleted file mode")) status = "deleted";
    else if (line.startsWith("rename from ")) {
      status = "renamed";
      oldPath = cleanPath(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      status = "renamed";
      newPath = cleanPath(line.slice("rename to ".length));
    } else if (line.startsWith("--- ")) oldPath = cleanPath(line.slice(4));
    else if (line.startsWith("+++ ")) newPath = cleanPath(line.slice(4));
    else if (line.startsWith("Binary files")) binary = true;

    i++;
  }

  // Hunk section.
  while (i < lines.length) {
    const line = lines[i]!;
    if (FILE_HEADER.test(line)) break;
    const m = HUNK_HEADER.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const { hunk, next } = parseHunk(lines, i, m);
    hunks.push(hunk);
    i = next;
  }

  return { file: { oldPath, newPath, status, binary, hunks }, next: i };
}

function parseHunk(lines: string[], start: number, header: RegExpExecArray): { hunk: Hunk; next: number } {
  const oldStart = Number(header[1]);
  const oldLines = header[2] === undefined ? 1 : Number(header[2]);
  const newStart = Number(header[3]);
  const newLines = header[4] === undefined ? 1 : Number(header[4]);

  const body: DiffLine[] = [];
  let oldCursor = oldStart;
  let newCursor = newStart;

  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (FILE_HEADER.test(line) || HUNK_HEADER.test(line)) break;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = line[0];
    const content = line.slice(1);
    if (marker === "+") {
      body.push({ kind: "add", content, oldLineNo: null, newLineNo: newCursor++ });
    } else if (marker === "-") {
      body.push({ kind: "del", content, oldLineNo: oldCursor++, newLineNo: null });
    } else if (marker === " ") {
      body.push({ kind: "context", content, oldLineNo: oldCursor++, newLineNo: newCursor++ });
    } else {
      break; // blank/non-diff line terminates the hunk body
    }
  }

  return {
    hunk: { header: header[0], oldStart, oldLines, newStart, newLines, lines: body },
    next: i,
  };
}
