import type { ReviewReport } from "../domain/schemas/report.ts";
import type { VerifiedFinding } from "../domain/schemas/verdict.ts";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

function loc(f: VerifiedFinding): string {
  return f.lineStart === f.lineEnd ? `${f.file}:${f.lineStart}` : `${f.file}:${f.lineStart}–${f.lineEnd}`;
}

function renderFinding(f: VerifiedFinding): string {
  const emoji = SEVERITY_EMOJI[f.severity] ?? "•";
  const flags = f.verdict.unverified
    ? "⚠️ unverified (verifier failed)"
    : `verifier ${f.verdict.outcome} (${f.verdict.verifierConfidence.toFixed(2)})`;
  const parts = [`### ${emoji} ${f.severity} — ${loc(f)} · ${f.concern}`, "", `**${f.title}**`, "", f.rationale];
  if (f.suggestedFix) parts.push("", `_Suggested fix:_ ${f.suggestedFix}`);
  parts.push("", `_Kept by ${f.keptBy.join(", ")} · ${f.reviewerVotes} vote(s) · ${flags}_`);
  return parts.join("\n");
}

/** Render a review report as human-facing Markdown. Pure. */
export function renderReportMarkdown(report: ReviewReport): string {
  const out: string[] = [];
  out.push(`# Code review — run \`${report.runId}\``, "");
  out.push(`**Status:** ${report.runStatus} · **Files:** ${report.diffSummary.files} · **Hunks:** ${report.diffSummary.hunks}`);
  out.push(
    `**Cost:** ~$${report.cost.usd.toFixed(4)} (${report.cost.inputTokens} in / ${report.cost.outputTokens} out tokens) · **Latency:** ${report.latencyMs}ms`,
    "",
  );

  out.push(`## Findings (${report.findings.length} kept)`);
  if (report.findings.length === 0) out.push("", "_No findings survived verification._");
  for (const f of report.findings) out.push("", renderFinding(f));

  if (report.droppedFindings.length > 0) {
    out.push("", `## Dropped by the verifier (${report.droppedFindings.length})`, "");
    for (const f of report.droppedFindings) {
      out.push(`- ${loc(f)} · ${f.concern} — “${f.title}” — ${f.verdict.outcome} (${f.verdict.verifierConfidence.toFixed(2)}): ${f.verdict.reasoning}`);
    }
  }

  if (report.failedNodes.length > 0) {
    out.push("", `## Coverage gaps (${report.failedNodes.length} failed node(s))`, "");
    for (const n of report.failedNodes) {
      out.push(`- ${n.type}${n.concern ? ` (${n.concern})` : ""}${n.file ? ` on ${n.file}` : ""} — ${n.reason}`);
    }
  }

  const tiers = Object.entries(report.tiering)
    .map(([role, model]) => `${role}: ${model}`)
    .join(" · ");
  if (tiers) out.push("", "## Models", "", tiers);

  return `${out.join("\n")}\n`;
}
