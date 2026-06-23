import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const domainFiles = [...new Glob("src/domain/**/*.ts").scanSync(".")];

describe("hexagonal boundary — the domain depends only inward", () => {
  test("there are domain files to check", () => {
    expect(domainFiles.length).toBeGreaterThan(5);
  });

  test("no domain file imports the Anthropic SDK", () => {
    for (const file of domainFiles) {
      expect(readFileSync(file, "utf8")).not.toContain("@anthropic-ai/sdk");
    }
  });

  test("no domain file imports node:fs or other IO builtins", () => {
    const io = /from\s+["']node:(fs|os|path|crypto|http|https|net|child_process)["']/;
    for (const file of domainFiles) {
      expect(readFileSync(file, "utf8")).not.toMatch(io);
    }
  });

  test("no domain file reaches out into adapters or render", () => {
    const outward = /from\s+["'][^"']*\/(adapters|render|cli)\//;
    for (const file of domainFiles) {
      expect(readFileSync(file, "utf8")).not.toMatch(outward);
    }
  });
});
