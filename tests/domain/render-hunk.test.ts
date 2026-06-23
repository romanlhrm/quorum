import { describe, expect, test } from "bun:test";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";
import { renderHunkWindow } from "../../src/domain/diff/render-hunk.ts";

const raw = [
  "diff --git a/src/math.ts b/src/math.ts",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -1,3 +1,4 @@",
  " export function add(a: number, b: number) {",
  "-  return a - b;",
  "+  return a + b;",
  "+  // fixed",
  " }",
].join("\n");

describe("renderHunkWindow", () => {
  const file = parseDiff(raw).files[0]!;
  const out = renderHunkWindow(file.newPath!, file.hunks[0]!);

  test("labels the file and hunk header", () => {
    expect(out).toContain("File: src/math.ts");
    expect(out).toContain("@@ -1,3 +1,4 @@");
  });

  test("added lines carry their NEW-file line number and a + marker", () => {
    expect(out).toContain("   2 +   return a + b;");
    expect(out).toContain("   3 +   // fixed");
  });

  test("deleted lines are marked and have no new-file line number", () => {
    expect(out).toContain("   · -   return a - b;");
  });

  test("context lines carry their number with no marker", () => {
    expect(out).toContain("   1   export function add(a: number, b: number) {");
    expect(out).toContain("   4   }");
  });
});
