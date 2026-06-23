import { describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/domain/dag/scheduler.ts";
import type { DagNode } from "../../src/domain/dag/dag.ts";
import type { NodeRunStatus } from "../../src/domain/dag/scheduler.ts";

function node(id: string, parents: string[]): DagNode {
  return { id, parents, status: "pending" };
}

/** Deterministic async exec: resolves after a microtask-ish delay per the map. */
function execFrom(outcomes: Record<string, NodeRunStatus | "throw">, log?: string[]) {
  return async (n: DagNode): Promise<NodeRunStatus> => {
    log?.push(n.id);
    await Promise.resolve();
    const o = outcomes[n.id] ?? "success";
    if (o === "throw") throw new Error(`boom ${n.id}`);
    return o;
  };
}

describe("runScheduler", () => {
  test("runs a dependency chain in topological order", async () => {
    const order: string[] = [];
    const nodes = [node("a", []), node("b", ["a"]), node("c", ["b"])];
    await runScheduler(nodes, 4, execFrom({}, order));
    expect(order).toEqual(["a", "b", "c"]);
    expect(nodes.map((n) => n.status)).toEqual(["success", "success", "success"]);
  });

  test("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const nodes = ["a", "b", "c", "d", "e"].map((id) => node(id, []));
    const exec = async (): Promise<NodeRunStatus> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return "success";
    };
    await runScheduler(nodes, 2, exec);
    expect(peak).toBe(2);
    expect(nodes.every((n) => n.status === "success")).toBe(true);
  });

  test("a failed parent blocks its child; the child's exec never runs", async () => {
    const ran: string[] = [];
    const nodes = [node("a", []), node("b", ["a"])];
    await runScheduler(nodes, 4, execFrom({ a: "throw" }, ran));
    expect(nodes.find((n) => n.id === "a")!.status).toBe("failed");
    expect(nodes.find((n) => n.id === "b")!.status).toBe("blocked");
    expect(ran).toEqual(["a"]); // b never executed
  });

  test("one failure does not stall an independent branch", async () => {
    const nodes = [node("a", []), node("b", ["a"]), node("c", [])];
    await runScheduler(nodes, 4, execFrom({ a: "throw" }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.status]));
    expect(byId).toEqual({ a: "failed", b: "blocked", c: "success" });
  });

  test("blocked propagates transitively down a chain", async () => {
    const nodes = [node("a", []), node("b", ["a"]), node("c", ["b"])];
    await runScheduler(nodes, 4, execFrom({ a: "throw" }));
    expect(nodes.map((n) => n.status)).toEqual(["failed", "blocked", "blocked"]);
  });

  test("throws on a cycle rather than hanging", async () => {
    const nodes = [node("a", ["b"]), node("b", ["a"])];
    await expect(runScheduler(nodes, 4, execFrom({}))).rejects.toThrow(/cycle|deadlock/i);
  });
});
