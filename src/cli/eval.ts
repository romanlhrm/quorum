import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeProvider, resolveMode } from "../adapters/llm/make-provider.ts";
import { systemClock } from "../adapters/system-clock.ts";
import { DEFAULT_CONCURRENCY, DEFAULT_FIXTURES_DIR, DEFAULT_KEEP } from "../config.ts";
import { parseDiff } from "../domain/diff/parse-diff.ts";
import type { Clock } from "../domain/ports/clock.ts";
import { TruthManifest } from "../domain/schemas/eval.ts";
import { runEval, type EvalCase } from "../eval/run-eval.ts";
import { renderEvalTable } from "../render/eval-table.ts";

const DATASET_DIR = "eval/dataset";
const MATCH_TOLERANCE = 3; // a finding matches within ±3 lines; concern must match

function loadCases(dir: string): EvalCase[] {
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".diff"))
    .map((f) => f.slice(0, -".diff".length))
    .sort();
  return names.map((name) => ({
    name,
    diff: parseDiff(readFileSync(join(dir, `${name}.diff`), "utf8")),
    truth: TruthManifest.parse(JSON.parse(readFileSync(join(dir, `${name}.truth.json`), "utf8"))),
  }));
}

function counterClock(): Clock {
  let t = 0;
  return { now: () => (t += 1) };
}

export async function main(env: Record<string, string | undefined>): Promise<number> {
  const cases = loadCases(env["DATASET_DIR"] ?? DATASET_DIR);
  const mode = resolveMode(env);
  const provider = makeProvider({ mode, fixturesDir: env["FIXTURES_DIR"] ?? DEFAULT_FIXTURES_DIR });
  const clock = mode === "replay" ? counterClock() : systemClock;

  const result = await runEval(
    cases,
    { provider, cfg: DEFAULT_KEEP, concurrency: DEFAULT_CONCURRENCY, clock },
    MATCH_TOLERANCE,
  );

  process.stdout.write(renderEvalTable(result));
  process.stderr.write(`\n${cases.length} case(s) · provider=${mode}\n`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.env));
}
