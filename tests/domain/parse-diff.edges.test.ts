import { describe, expect, test } from "bun:test";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";

describe("parseDiff — file statuses", () => {
  test("added file: oldPath null, all lines added", () => {
    const raw = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..abcdef0",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+export const x = 1;",
      "+export const y = 2;",
    ].join("\n");
    const file = parseDiff(raw).files[0]!;
    expect(file.status).toBe("added");
    expect(file.oldPath).toBeNull();
    expect(file.newPath).toBe("src/new.ts");
    expect(file.hunks[0]!.lines.map((l) => [l.kind, l.oldLineNo, l.newLineNo])).toEqual([
      ["add", null, 1],
      ["add", null, 2],
    ]);
  });

  test("deleted file: newPath null, all lines removed", () => {
    const raw = [
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "index abcdef0..0000000",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const x = 1;",
      "-export const y = 2;",
    ].join("\n");
    const file = parseDiff(raw).files[0]!;
    expect(file.status).toBe("deleted");
    expect(file.oldPath).toBe("src/old.ts");
    expect(file.newPath).toBeNull();
    expect(file.hunks[0]!.lines.map((l) => l.oldLineNo)).toEqual([1, 2]);
  });

  test("pure rename: both paths set, no hunks", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/b.ts",
      "similarity index 100%",
      "rename from src/a.ts",
      "rename to src/b.ts",
    ].join("\n");
    const file = parseDiff(raw).files[0]!;
    expect(file.status).toBe("renamed");
    expect(file.oldPath).toBe("src/a.ts");
    expect(file.newPath).toBe("src/b.ts");
    expect(file.hunks).toHaveLength(0);
  });

  test("binary file: flagged, paths recovered from the diff --git line", () => {
    const raw = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");
    const file = parseDiff(raw).files[0]!;
    expect(file.binary).toBe(true);
    expect(file.hunks).toHaveLength(0);
    expect(file.oldPath).toBe("assets/logo.png");
    expect(file.newPath).toBe("assets/logo.png");
  });
});

describe("parseDiff — structure", () => {
  test("two files in one diff are split", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-const b = 1;",
      "+const b = 2;",
    ].join("\n");
    const diff = parseDiff(raw);
    expect(diff.files.map((f) => f.newPath)).toEqual(["a.ts", "b.ts"]);
  });

  test("second hunk in a file resumes line numbering from its own header", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,2 @@",
      " const a = 1;",
      "-const b = 1;",
      "+const b = 2;",
      "@@ -10,2 +10,3 @@",
      " const j = 9;",
      "+const k = 10;",
      " const l = 11;",
    ].join("\n");
    const hunks = parseDiff(raw).files[0]!.hunks;
    expect(hunks).toHaveLength(2);
    expect(hunks[1]!.lines.map((l) => [l.content, l.oldLineNo, l.newLineNo])).toEqual([
      ["const j = 9;", 10, 10],
      ["const k = 10;", null, 11],
      ["const l = 11;", 11, 12],
    ]);
  });

  test("omitted hunk counts default to 1", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -5 +5 @@",
      "-x",
      "+y",
    ].join("\n");
    const hunk = parseDiff(raw).files[0]!.hunks[0]!;
    expect([hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]).toEqual([5, 1, 5, 1]);
  });

  test("surrounding context lines are preserved (the -U20 review window)", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,4 +1,4 @@",
      " const before2 = 1;",
      " const before1 = 2;",
      "-const target = 3;",
      "+const target = 4;",
      " const after1 = 5;",
    ].join("\n");
    const lines = parseDiff(raw).files[0]!.hunks[0]!.lines;
    expect(lines.filter((l) => l.kind === "context").map((l) => l.content)).toEqual([
      "const before2 = 1;",
      "const before1 = 2;",
      "const after1 = 5;",
    ]);
  });
});
