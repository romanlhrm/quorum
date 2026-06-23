import { describe, expect, test } from "bun:test";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";

describe("parseDiff — single modified file", () => {
  const raw = [
    "diff --git a/src/math.ts b/src/math.ts",
    "index 1111111..2222222 100644",
    "--- a/src/math.ts",
    "+++ b/src/math.ts",
    "@@ -1,3 +1,4 @@",
    " export function add(a: number, b: number) {",
    "-  return a - b;",
    "+  return a + b;",
    "+  // fixed",
    " }",
    "",
  ].join("\n");

  test("extracts the file with modified status and both paths", () => {
    const diff = parseDiff(raw);
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0]!;
    expect(file.status).toBe("modified");
    expect(file.oldPath).toBe("src/math.ts");
    expect(file.newPath).toBe("src/math.ts");
    expect(file.binary).toBe(false);
    expect(file.hunks).toHaveLength(1);
  });

  test("parses the hunk header counts", () => {
    const hunk = parseDiff(raw).files[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(4);
  });

  test("maps every line to the correct old/new line number", () => {
    const lines = parseDiff(raw).files[0]!.hunks[0]!.lines;
    expect(lines).toEqual([
      { kind: "context", content: "export function add(a: number, b: number) {", oldLineNo: 1, newLineNo: 1 },
      { kind: "del", content: "  return a - b;", oldLineNo: 2, newLineNo: null },
      { kind: "add", content: "  return a + b;", oldLineNo: null, newLineNo: 2 },
      { kind: "add", content: "  // fixed", oldLineNo: null, newLineNo: 3 },
      { kind: "context", content: "}", oldLineNo: 3, newLineNo: 4 },
    ]);
  });
});
