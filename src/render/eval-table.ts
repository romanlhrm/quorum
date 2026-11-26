import type { EvalResult } from "../eval/run-eval.ts";
import type { AggregateScore } from "../eval/scorer.ts";

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function row(label: string, s: AggregateScore): string {
  return `| ${label} | ${pct(s.recall)} | ${pct(s.precision)} | ${pct(s.falsePositiveRate)} | ${s.tp} | ${s.fp} | ${s.missed} |`;
}

/** Render the eval result as a Markdown scoreboard. Pure. */
export function renderEvalTable(r: EvalResult): string {
  const out: string[] = [];
  out.push("## Eval scoreboard", "");
  out.push("| config | recall | precision | FP-rate | TP | FP | missed |");
  out.push("|---|---|---|---|---|---|---|");
  out.push(row("reviewers only (no verifier)", r.withoutVerifier));
  out.push(row("+ isolated verifier", r.withVerifier));
  out.push("");
  const dp = r.withVerifier.precision - r.withoutVerifier.precision;
  const dr = r.withVerifier.recall - r.withoutVerifier.recall;
  const pLabel = dp > 0 ? "gain" : dp < 0 ? "loss" : "no change";
  const rLabel = dr < 0 ? "cost" : dr > 0 ? "gain" : "no cost";
  out.push(
    `**Verifier impact:** precision ${pct(r.withoutVerifier.precision)} → ${pct(r.withVerifier.precision)} (${pLabel}), ` +
      `recall ${pct(r.withoutVerifier.recall)} → ${pct(r.withVerifier.recall)} (${rLabel}).`,
  );
  out.push("");
  out.push("### Keep-threshold sensitivity", "");
  out.push("| threshold | recall | precision | FP-rate |");
  out.push("|---|---|---|---|");
  for (const s of r.sensitivity) {
    out.push(`| ${s.threshold} | ${pct(s.score.recall)} | ${pct(s.score.precision)} | ${pct(s.score.falsePositiveRate)} |`);
  }
  out.push("");
  out.push("### Per case", "");
  out.push("| case | kept / found | run |");
  out.push("|---|---|---|");
  for (const c of r.perCase) {
    out.push(`| ${c.name} | ${c.kept} / ${c.total} | ${c.runStatus} |`);
  }
  return `${out.join("\n")}\n`;
}
