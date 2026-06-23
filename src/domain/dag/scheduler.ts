import { readySet, type DagNode } from "./dag.ts";

/** The outcome an exec reports for a node (a throw is treated as "failed"). */
export type NodeRunStatus = "success" | "partial" | "failed";

/**
 * Drive a DAG to completion: repeatedly run the nodes whose parents have all
 * produced usable output, up to `cap` at a time, marking children of failed
 * nodes as blocked. Mutates each node's `status` in place.
 *
 * Deterministic given a deterministic `exec`. A node that throws becomes
 * `failed` (its subtree blocks) — one failure never stalls an independent
 * branch. Unsatisfiable graphs (cycles, missing parents) throw rather than hang.
 */
export async function runScheduler<N extends DagNode>(
  nodes: N[],
  cap: number,
  exec: (node: N) => Promise<NodeRunStatus>,
): Promise<void> {
  const inFlight = new Map<string, Promise<void>>();

  while (true) {
    const { runnable, blocked } = readySet(nodes);
    for (const b of blocked) b.status = "blocked";

    for (const n of runnable) {
      if (inFlight.size >= cap) break;
      n.status = "running";
      const p = exec(n)
        .then((s) => {
          n.status = s;
        })
        .catch(() => {
          n.status = "failed";
        })
        .finally(() => {
          inFlight.delete(n.id);
        });
      inFlight.set(n.id, p);
    }

    if (inFlight.size > 0) {
      await Promise.race(inFlight.values());
      continue;
    }

    if (!nodes.some((n) => n.status === "pending")) break;

    // Pending nodes remain, nothing is running, and nothing became runnable or
    // blocked this pass → the remaining dependencies can never be satisfied.
    const after = readySet(nodes);
    if (after.runnable.length === 0 && after.blocked.length === 0) {
      throw new Error("scheduler: cycle or deadlock — pending nodes with no runnable path");
    }
  }
}
