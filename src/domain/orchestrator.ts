import { aggregate, dedupeWithinConcern } from "./agents/aggregate.ts";
import type { KeepConfig } from "./agents/decide-keep.ts";
import { plan } from "./agents/planner.ts";
import { usdFor } from "./agents/pricing.ts";
import { review } from "./agents/reviewer.ts";
import { verify } from "./agents/verifier.ts";
import type { DagNode } from "./dag/dag.ts";
import type { NodeStatus } from "./dag/node.ts";
import { runScheduler } from "./dag/scheduler.ts";
import type { Diff } from "./diff/diff.types.ts";
import { hunkByIndex, hunkContainingNewLine } from "./diff/hunk-lookup.ts";
import type { Clock } from "./ports/clock.ts";
import type { LLMProvider } from "./ports/llm-provider.ts";
import type { Concern } from "./schemas/common.ts";
import type { RawFinding } from "./schemas/finding.ts";
import type { Cost, FailedNode } from "./schemas/report.ts";
import type { ReviewReport } from "./schemas/report.ts";
import type { ReviewTask } from "./schemas/review-plan.ts";
import type { NodeType, TraceRecord, TraceStatus } from "./schemas/trace.ts";
import type { VerifierVerdict } from "./schemas/verdict.ts";

export interface ReviewDeps {
  readonly provider: LLMProvider;
  readonly cfg: KeepConfig;
  readonly concurrency: number;
  readonly runId: string;
  readonly clock: Clock;
}

export interface ReviewOutcome {
  readonly report: ReviewReport;
  readonly trace: TraceRecord[];
}

interface CallMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  providerMode: "live" | "replay" | "record";
}

/** Wrap a provider to capture the metadata of the single call an agent makes. */
function observe(provider: LLMProvider): { provider: LLMProvider; calls: CallMeta[] } {
  const calls: CallMeta[] = [];
  return {
    calls,
    provider: {
      async complete(req, schema) {
        const r = await provider.complete(req, schema);
        calls.push({
          model: r.model,
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          latencyMs: r.latencyMs,
          attempts: r.attempts,
          providerMode: r.providerMode,
        });
        return r;
      },
    },
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run the full review pipeline: plan → parallel reviewers → dedup → parallel
 * verifiers → aggregate. Each phase runs through the capped scheduler, so node
 * count varies with the diff and one node's failure never stalls its siblings.
 * Failures degrade rather than crash: a dead planner yields an empty report, a
 * dead reviewer leaves a visible coverage gap, a dead verifier keeps its finding
 * flagged `unverified`. Emits one trace record per executed node.
 */
export async function runReview(diff: Diff, deps: ReviewDeps): Promise<ReviewOutcome> {
  const { provider, cfg, concurrency, runId, clock } = deps;
  const trace: TraceRecord[] = [];
  const failedNodes: FailedNode[] = [];
  const usage: CallMeta[] = [];
  const tiering: Record<string, string> = {};
  const runStart = clock.now();
  const diffSummary = {
    files: diff.files.length,
    hunks: diff.files.reduce((n, f) => n + f.hunks.length, 0),
  };

  const record = (r: Omit<TraceRecord, "runId">): void => {
    trace.push({ ...r, runId });
  };
  const account = (meta: CallMeta | undefined, role: string): void => {
    if (!meta) return;
    usage.push(meta);
    tiering[role] = meta.model;
  };

  // 1. PLAN -----------------------------------------------------------------
  const planObs = observe(provider);
  const planStart = clock.now();
  let tasks: ReviewTask[] = [];
  let plannerOk = true;
  try {
    tasks = await plan(diff, planObs.provider);
  } catch (e) {
    plannerOk = false;
    failedNodes.push({ nodeId: "planner", type: "planner", concern: null, file: null, reason: errMsg(e) });
  }
  const planMeta = planObs.calls[0];
  account(planMeta, "planner");
  record(
    traceFor({
      nodeId: "planner",
      type: "planner",
      parentNodeIds: [],
      concern: null,
      target: null,
      meta: planMeta,
      status: plannerOk ? "success" : "failed",
      error: plannerOk ? null : (failedNodes.at(-1)?.reason ?? null),
      inputSummary: `${diffSummary.hunks} hunk(s)`,
      outputSummary: plannerOk ? `${tasks.length} task(s)` : "planning failed",
      start: planStart,
      end: clock.now(),
    }),
  );

  if (!plannerOk) {
    return finish([], failedNodes, { runId, diffSummary, usage, tiering, cfg, runStart, clock, trace, record });
  }

  // 2. REVIEW (parallel) ----------------------------------------------------
  interface ReviewerNode extends DagNode {
    task: ReviewTask;
  }
  const reviewerNodes: ReviewerNode[] = tasks.map((task) => ({ id: task.id, parents: [], status: "pending" as NodeStatus, task }));
  const findingsByNode = new Map<string, RawFinding[]>();

  await runScheduler(reviewerNodes, concurrency, async (node) => {
    const hunk = hunkByIndex(diff, node.task.file, node.task.hunkIndex);
    const obs = observe(provider);
    const start = clock.now();
    if (!hunk) {
      failedNodes.push({ nodeId: node.id, type: "reviewer", concern: node.task.concern, file: node.task.file, reason: "hunk not found" });
      record(traceFor({ nodeId: node.id, type: "reviewer", parentNodeIds: ["planner"], concern: node.task.concern, target: { file: node.task.file, hunkIndex: node.task.hunkIndex }, meta: undefined, status: "failed", error: "hunk not found", inputSummary: node.task.concern, outputSummary: "no hunk", start, end: clock.now() }));
      return "failed";
    }
    try {
      const findings = await review(node.task, hunk, obs.provider);
      findingsByNode.set(node.id, findings);
      account(obs.calls[0], "reviewer");
      record(traceFor({ nodeId: node.id, type: "reviewer", parentNodeIds: ["planner"], concern: node.task.concern, target: { file: node.task.file, hunkIndex: node.task.hunkIndex }, meta: obs.calls[0], status: "success", error: null, inputSummary: node.task.concern, outputSummary: `${findings.length} finding(s)`, start, end: clock.now() }));
      return "success";
    } catch (e) {
      failedNodes.push({ nodeId: node.id, type: "reviewer", concern: node.task.concern, file: node.task.file, reason: errMsg(e) });
      record(traceFor({ nodeId: node.id, type: "reviewer", parentNodeIds: ["planner"], concern: node.task.concern, target: { file: node.task.file, hunkIndex: node.task.hunkIndex }, meta: obs.calls[0], status: "failed", error: errMsg(e), inputSummary: node.task.concern, outputSummary: "reviewer failed", start, end: clock.now() }));
      return "failed";
    }
  });

  const deduped = dedupeWithinConcern([...findingsByNode.values()].flat());

  // 3. VERIFY (parallel) ----------------------------------------------------
  interface VerifierNode extends DagNode {
    finding: RawFinding;
  }
  const verifierNodes: VerifierNode[] = deduped.map((finding) => ({ id: `v:${finding.id}`, parents: [], status: "pending" as NodeStatus, finding }));
  const verdictByFinding = new Map<string, VerifierVerdict>();

  await runScheduler(verifierNodes, concurrency, async (node) => {
    const parent = node.finding.id.replace(/#\d+$/, "");
    const hunk = hunkContainingNewLine(diff, node.finding.file, node.finding.lineStart);
    const obs = observe(provider);
    const start = clock.now();
    try {
      if (!hunk) throw new Error("no hunk for finding location");
      const verdict = await verify(node.finding, hunk, obs.provider);
      verdictByFinding.set(node.finding.id, verdict);
      account(obs.calls[0], "verifier");
      record(traceFor({ nodeId: node.id, type: "verifier", parentNodeIds: [parent], concern: node.finding.concern, target: { file: node.finding.file, hunkIndex: 0 }, meta: obs.calls[0], status: "success", error: null, inputSummary: node.finding.title, outputSummary: verdict.outcome, start, end: clock.now() }));
      return "success";
    } catch (e) {
      verdictByFinding.set(node.finding.id, {
        findingId: node.finding.id,
        outcome: "upheld",
        verifierConfidence: 0,
        reasoning: `verifier failed; kept unverified: ${errMsg(e)}`,
        unverified: true,
      });
      failedNodes.push({ nodeId: node.id, type: "verifier", concern: node.finding.concern, file: node.finding.file, reason: errMsg(e) });
      record(traceFor({ nodeId: node.id, type: "verifier", parentNodeIds: [parent], concern: node.finding.concern, target: { file: node.finding.file, hunkIndex: 0 }, meta: obs.calls[0], status: "failed", error: errMsg(e), inputSummary: node.finding.title, outputSummary: "verifier failed (kept unverified)", start, end: clock.now() }));
      return "failed";
    }
  });

  const items = deduped.map((finding) => ({ finding, verdict: verdictByFinding.get(finding.id)! }));
  return finish(items, failedNodes, { runId, diffSummary, usage, tiering, cfg, runStart, clock, trace, record });
}

// --- helpers ---------------------------------------------------------------

interface TraceArgs {
  nodeId: string;
  type: NodeType;
  parentNodeIds: string[];
  concern: Concern | null;
  target: { file: string; hunkIndex: number } | null;
  meta: CallMeta | undefined;
  status: TraceStatus;
  error: string | null;
  inputSummary: string;
  outputSummary: string;
  start: number;
  end: number;
}

function traceFor(a: TraceArgs): Omit<TraceRecord, "runId"> {
  return {
    nodeId: a.nodeId,
    type: a.type,
    parentNodeIds: a.parentNodeIds,
    concern: a.concern,
    target: a.target,
    model: a.meta?.model ?? null,
    effort: null,
    inputSummary: a.inputSummary,
    outputSummary: a.outputSummary,
    tokens: a.meta ? { input: a.meta.inputTokens, output: a.meta.outputTokens } : null,
    latencyMs: a.meta?.latencyMs ?? a.end - a.start,
    attempts: a.meta?.attempts ?? 0,
    status: a.status,
    error: a.error,
    startedAt: a.start,
    endedAt: a.end,
    providerMode: a.meta?.providerMode ?? "replay",
  };
}

interface FinishCtx {
  runId: string;
  diffSummary: { files: number; hunks: number };
  usage: CallMeta[];
  tiering: Record<string, string>;
  cfg: KeepConfig;
  runStart: number;
  clock: Clock;
  trace: TraceRecord[];
  record: (r: Omit<TraceRecord, "runId">) => void;
}

function sumCost(usage: CallMeta[]): Cost {
  let inputTokens = 0;
  let outputTokens = 0;
  let usd = 0;
  for (const u of usage) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    usd += usdFor(u.model, u.inputTokens, u.outputTokens);
  }
  return { inputTokens, outputTokens, usd };
}

function finish(
  items: Array<{ finding: RawFinding; verdict: VerifierVerdict }>,
  failedNodes: FailedNode[],
  ctx: FinishCtx,
): ReviewOutcome {
  const aggStart = ctx.clock.now();
  const report = aggregate({
    runId: ctx.runId,
    diffSummary: ctx.diffSummary,
    items,
    failedNodes,
    cost: sumCost(ctx.usage),
    latencyMs: aggStart - ctx.runStart,
    tiering: ctx.tiering,
    cfg: ctx.cfg,
  });
  ctx.record(
    traceFor({
      nodeId: "aggregator",
      type: "aggregator",
      parentNodeIds: items.map((i) => `v:${i.finding.id}`),
      concern: null,
      target: null,
      meta: undefined,
      status: report.runStatus === "partial" ? "partial" : "success",
      error: null,
      inputSummary: `${items.length} verified finding(s)`,
      outputSummary: `${report.findings.length} kept, ${report.droppedFindings.length} dropped`,
      start: aggStart,
      end: ctx.clock.now(),
    }),
  );
  return { report, trace: ctx.trace };
}
