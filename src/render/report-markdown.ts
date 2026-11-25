import type { ReviewReport } from "../domain/schemas/report.ts";
import type { VerifiedFinding } from "../domain/schemas/verdict.ts";
import { overlaps } from "../domain/agents/aggregate.ts";

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

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Same issue seen through two lenses: overlapping lines and the same title. */
function sameIssue(a: VerifiedFinding, b: VerifiedFinding): boolean {
  if (!overlaps(a, b)) return false;
  const ta = normTitle(a.title);
  const tb = normTitle(b.title);
  return ta === tb || ta.startsWith(tb) || tb.startsWith(ta);
}

/**
 * Group kept findings that describe the same issue from different concerns
 * (e.g. security and correctness both flag one SQL injection). The pipeline
 * keeps them separate on purpose, since each concern counts as a vote; the
 * report shows them once so a reader isn't handed the same bug twice.
 * Input order is preserved, so the first finding of a group leads it.
 */
export function groupSameIssue(findings: readonly VerifiedFinding[]): VerifiedFinding[][] {
  const groups: VerifiedFinding[][] = [];
  for (const f of findings) {
    const g = groups.find((grp) => grp.some((o) => sameIssue(o, f)));
    if (g) g.push(f);
    else groups.push([f]);
  }
  return groups;
}

function renderGroup(group: VerifiedFinding[]): string {
  const f = group[0]!;
  const emoji = SEVERITY_EMOJI[f.severity] ?? "•";
  const concerns = [...new Set(group.map((g) => g.concern))].join(" + ");
  const best = group.reduce((a, b) => (b.verdict.verifierConfidence > a.verdict.verifierConfidence ? b : a));
  const flags = best.verdict.unverified
    ? "⚠️ unverified (verifier failed)"
    : `verifier ${best.verdict.outcome} (${best.verdict.verifierConfidence.toFixed(2)})`;
  const parts = [`### ${emoji} ${f.severity} — ${loc(f)} · ${concerns}`, "", `**${f.title}**`, "", f.rationale];
  if (f.suggestedFix) parts.push("", `_Suggested fix:_ ${f.suggestedFix}`);
  const merged = group.length > 1 ? ` · reported by ${group.length} reviewers, shown once` : "";
  parts.push("", `_Kept by ${f.keptBy.join(", ")} · ${f.reviewerVotes} vote(s) · ${flags}${merged}_`);
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

  const groups = groupSameIssue(report.findings);
  const count =
    groups.length === report.findings.length
      ? `${report.findings.length} kept`
      : `${groups.length} issues, from ${report.findings.length} kept findings`;
  out.push(`## Findings (${count})`);
  if (report.findings.length === 0) out.push("", "_No findings survived verification._");
  for (const g of groups) out.push("", renderGroup(g));

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
