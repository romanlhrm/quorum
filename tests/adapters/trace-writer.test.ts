import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderJsonl, writeTrace } from "../../src/adapters/io/trace-writer.ts";
import { TraceRecord } from "../../src/domain/schemas/trace.ts";
import type { TraceRecord as TR } from "../../src/domain/schemas/trace.ts";

const rec: TR = {
  runId: "r",
  nodeId: "planner",
  type: "planner",
  parentNodeIds: [],
  concern: null,
  target: null,
  model: "claude-opus-4-8",
  effort: null,
  inputSummary: "2 hunks",
  outputSummary: "3 tasks",
  tokens: { input: 5, output: 1 },
  latencyMs: 10,
  attempts: 1,
  status: "success",
  error: null,
  startedAt: 0,
  endedAt: 10,
  providerMode: "replay",
};

let dir = "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("trace writer", () => {
  test("renderJsonl emits one valid TraceRecord per line", () => {
    const text = renderJsonl([rec, { ...rec, nodeId: "agg", type: "aggregator" }]);
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(TraceRecord.safeParse(JSON.parse(line)).success).toBe(true);
    }
  });

  test("writeTrace persists JSONL that round-trips", () => {
    dir = mkdtempSync(join(tmpdir(), "quorum-trace-"));
    const path = join(dir, "sub", "run.jsonl");
    writeTrace(path, [rec]);
    const back = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(back[0].nodeId).toBe("planner");
  });
});
