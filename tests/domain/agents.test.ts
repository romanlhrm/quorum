import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { plan } from "../../src/domain/agents/planner.ts";
import { review } from "../../src/domain/agents/reviewer.ts";
import { verify } from "../../src/domain/agents/verifier.ts";
import { parseDiff } from "../../src/domain/diff/parse-diff.ts";
import type { LLMProvider, LlmRequest, LlmResult } from "../../src/domain/ports/llm-provider.ts";
import type { RawFinding } from "../../src/domain/schemas/finding.ts";

/** Fake provider: validates canned output against the real schema, records the request. */
function fake(parsed: unknown, sink?: (req: LlmRequest) => void): LLMProvider {
  return {
    async complete<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<LlmResult<T>> {
      sink?.(req);
      return {
        parsed: schema.parse(parsed),
        raw: JSON.stringify(parsed),
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
        model: "m",
        stopReason: "end_turn",
        attempts: 1,
        providerMode: "replay",
      };
    },
  };
}

const twoHunkDiff = parseDiff(
  [
    "diff --git a/app.ts b/app.ts",
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 1;",
    "+const b = 2;",
    "@@ -10,2 +10,3 @@",
    " const j = 9;",
    "+const k = 10;",
    " const l = 11;",
  ].join("\n"),
);

describe("planner", () => {
  test("expands per-hunk concern selection into one task per (hunk, concern)", async () => {
    const provider = fake({
      items: [
        { file: "app.ts", hunkIndex: 0, concerns: ["correctness", "security"], reason: "logic + input" },
        { file: "app.ts", hunkIndex: 1, concerns: ["performance"], reason: "hot loop" },
      ],
    });
    const tasks = await plan(twoHunkDiff, provider);
    expect(tasks.map((t) => `${t.hunkIndex}:${t.concern}`).sort()).toEqual([
      "0:correctness",
      "0:security",
      "1:performance",
    ]);
    expect(tasks.every((t) => t.file === "app.ts")).toBe(true);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(3); // unique ids
  });

  test("calls the planner role and shows the diff in the prompt", async () => {
    let req: LlmRequest | undefined;
    await plan(twoHunkDiff, fake({ items: [] }, (r) => (req = r)));
    expect(req!.role).toBe("planner");
    expect(req!.user).toContain("app.ts");
    expect(req!.user).toContain("const b = 2;");
  });

  test("ignores plan items that reference a hunk that does not exist", async () => {
    const tasks = await plan(
      twoHunkDiff,
      fake({ items: [{ file: "app.ts", hunkIndex: 9, concerns: ["correctness"], reason: "x" }] }),
    );
    expect(tasks).toEqual([]);
  });
});

describe("reviewer", () => {
  const task = { id: "t:app.ts#0:security", file: "app.ts", hunkIndex: 0, concern: "security" as const };
  const hunk = twoHunkDiff.files[0]!.hunks[0]!;

  test("attaches id/concern/file and maps confidence to a RawFinding", async () => {
    const provider = fake({
      findings: [
        { lineStart: 2, lineEnd: 2, severity: "high", title: "Tainted input", rationale: "no validation", suggestedFix: "validate", confidence: 0.9 },
      ],
    });
    const findings = await review(task, hunk, provider);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.concern).toBe("security");
    expect(f.file).toBe("app.ts");
    expect(f.reviewerConfidence).toBe(0.9);
    expect(f.id).toContain("t:app.ts#0:security");
    expect(f.title).toBe("Tainted input");
  });

  test("uses the reviewer role and injects the concern's rubric", async () => {
    let req: LlmRequest | undefined;
    await review(task, hunk, fake({ findings: [] }, (r) => (req = r)));
    expect(req!.role).toBe("reviewer");
    expect(req!.system.toLowerCase()).toContain("security");
  });

  test("returns an empty list when the reviewer finds nothing", async () => {
    expect(await review(task, hunk, fake({ findings: [] }))).toEqual([]);
  });
});

describe("verifier", () => {
  const finding: RawFinding = {
    id: "f1",
    concern: "correctness",
    file: "app.ts",
    lineStart: 2,
    lineEnd: 2,
    severity: "high",
    title: "Off-by-one in loop bound",
    rationale: "uses <= instead of <",
    suggestedFix: null,
    reviewerConfidence: 0.8,
  };
  const hunk = twoHunkDiff.files[0]!.hunks[0]!;

  test("maps the verdict and attaches the finding id, not unverified", async () => {
    const verdict = await verify(finding, hunk, fake({ outcome: "refuted", confidence: 0.7, reasoning: "bound is correct" }));
    expect(verdict.findingId).toBe("f1");
    expect(verdict.outcome).toBe("refuted");
    expect(verdict.verifierConfidence).toBe(0.7);
    expect(verdict.unverified).toBe(false);
  });

  test("is isolated and refute-biased: prompt carries only this finding + hunk, system says refute", async () => {
    let req: LlmRequest | undefined;
    await verify(finding, hunk, fake({ outcome: "upheld", confidence: 0.9, reasoning: "real" }, (r) => (req = r)));
    expect(req!.role).toBe("verifier");
    expect(req!.system.toLowerCase()).toMatch(/refut|skeptic|disprove/);
    expect(req!.user).toContain("Off-by-one in loop bound");
    expect(req!.user).toContain("const b = 2;"); // the single hunk window
  });
});
