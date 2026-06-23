import { describe, expect, test } from "bun:test";
import { toJsonSchema } from "../../src/domain/schemas/to-json-schema.ts";
import { PlannerOutput } from "../../src/domain/schemas/review-plan.ts";
import { ReviewerFinding, ReviewerOutput } from "../../src/domain/schemas/finding.ts";
import { VerifierOutput } from "../../src/domain/schemas/verdict.ts";

const llmSchemas = { PlannerOutput, ReviewerOutput, VerifierOutput };

describe("LLM-boundary schemas live in the Anthropic-supported JSON Schema subset", () => {
  for (const [name, schema] of Object.entries(llmSchemas)) {
    test(`${name} derives a clean object schema`, () => {
      const js = toJsonSchema(schema);
      expect(js["type"]).toBe("object");
      expect(js["additionalProperties"]).toBe(false);
      expect(Array.isArray(js["required"])).toBe(true);
      // Anthropic tool input_schema is happiest fully inlined — no $ref/$defs.
      expect(JSON.stringify(js)).not.toContain("$ref");
      expect(JSON.stringify(js)).not.toContain("$defs");
    });
  }
});

describe("Zod refinements catch semantics the JSON Schema subset cannot", () => {
  test("ReviewerFinding rejects lineStart > lineEnd", () => {
    const r = ReviewerFinding.safeParse({
      lineStart: 9,
      lineEnd: 3,
      severity: "high",
      title: "t",
      rationale: "r",
      suggestedFix: null,
      confidence: 0.8,
    });
    expect(r.success).toBe(false);
  });

  test("ReviewerFinding accepts a well-formed finding", () => {
    const r = ReviewerFinding.safeParse({
      lineStart: 3,
      lineEnd: 9,
      severity: "high",
      title: "t",
      rationale: "r",
      suggestedFix: null,
      confidence: 0.8,
    });
    expect(r.success).toBe(true);
  });

  test("confidence is bounded to [0,1]", () => {
    const base = { lineStart: 1, lineEnd: 1, severity: "low", title: "t", rationale: "r", suggestedFix: null };
    expect(ReviewerFinding.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
    expect(ReviewerFinding.safeParse({ ...base, confidence: -0.1 }).success).toBe(false);
  });

  test("PlannerOutput requires at least one concern per item", () => {
    const r = PlannerOutput.safeParse({ items: [{ file: "a.ts", hunkIndex: 0, concerns: [], reason: "x" }] });
    expect(r.success).toBe(false);
  });

  test("strict schemas reject unknown keys", () => {
    const r = VerifierOutput.safeParse({ outcome: "upheld", confidence: 0.9, reasoning: "ok", extra: 1 });
    expect(r.success).toBe(false);
  });

  test("VerifierOutput rejects an outcome outside the enum", () => {
    const r = VerifierOutput.safeParse({ outcome: "maybe", confidence: 0.9, reasoning: "ok" });
    expect(r.success).toBe(false);
  });
});
