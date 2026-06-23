import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeProvider, resolveMode } from "../adapters/llm/make-provider.ts";
import { writeTrace } from "../adapters/io/trace-writer.ts";
import { systemClock } from "../adapters/system-clock.ts";
import { DEFAULT_CONCURRENCY, DEFAULT_FIXTURES_DIR, DEFAULT_KEEP } from "../config.ts";
import { parseDiff } from "../domain/diff/parse-diff.ts";
import { runReview } from "../domain/orchestrator.ts";
import type { Clock } from "../domain/ports/clock.ts";
import { renderReportMarkdown } from "../render/report-markdown.ts";
import { renderTraceSummary } from "../render/trace-summary.ts";

/** Deterministic counter clock — keeps replay traces stable (no wall time). */
function counterClock(): Clock {
  let t = 0;
  return { now: () => (t += 1) };
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const file = argv[0];
  if (!file) {
    process.stderr.write("usage: review <diff-file>   (PROVIDER=replay|record|live, default replay)\n");
    return 2;
  }

  const raw = readFileSync(file, "utf8");
  const diff = parseDiff(raw);
  if (diff.files.length === 0) {
    process.stderr.write("no reviewable files in diff (empty or binary-only)\n");
    return 1;
  }

  const mode = resolveMode(env);
  const provider = makeProvider({ mode, fixturesDir: env["FIXTURES_DIR"] ?? DEFAULT_FIXTURES_DIR });
  const runId = `run-${createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 8)}`;
  const clock = mode === "replay" ? counterClock() : systemClock;

  const { report, trace } = await runReview(diff, {
    provider,
    cfg: DEFAULT_KEEP,
    concurrency: DEFAULT_CONCURRENCY,
    runId,
    clock,
  });

  const tracePath = join("runs", `${runId}.jsonl`);
  writeTrace(tracePath, trace);

  process.stdout.write(renderReportMarkdown(report));
  process.stderr.write(`\n--- execution trace (${mode}) ---\n${renderTraceSummary(trace)}\n`);
  process.stderr.write(`\ntrace written to ${tracePath}\n`);

  return report.runStatus === "failed" ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2), process.env));
}
