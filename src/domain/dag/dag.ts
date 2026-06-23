import { isTerminalFailure, isTerminalOk, type NodeStatus } from "./node.ts";

/** The minimum a node must expose for the scheduler to drive it. */
export interface DagNode {
  readonly id: string;
  readonly parents: string[];
  status: NodeStatus;
}

/**
 * Classify the currently-pending nodes against their parents' statuses:
 * - `runnable` — every parent produced usable output (terminal-ok)
 * - `blocked`  — at least one parent is a terminal failure
 * A pending node with a parent still pending/running is neither (it waits).
 *
 * Failure is checked before readiness, so a node with one failed and one
 * succeeded parent is blocked, not runnable.
 */
export function readySet<N extends DagNode>(nodes: N[]): { runnable: N[]; blocked: N[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const runnable: N[] = [];
  const blocked: N[] = [];

  for (const node of nodes) {
    if (node.status !== "pending") continue;
    const parents = node.parents.map((id) => byId.get(id));
    if (parents.some((p) => p !== undefined && isTerminalFailure(p.status))) {
      blocked.push(node);
    } else if (parents.every((p) => p !== undefined && isTerminalOk(p.status))) {
      runnable.push(node);
    }
  }

  return { runnable, blocked };
}
