import { describe, expect, test } from "bun:test";
import { isTerminal, isTerminalOk } from "../../src/domain/dag/node.ts";
import { readySet } from "../../src/domain/dag/dag.ts";
import type { DagNode } from "../../src/domain/dag/dag.ts";

function node(id: string, parents: string[], status: DagNode["status"]): DagNode {
  return { id, parents, status };
}

describe("node status predicates", () => {
  test("terminal states", () => {
    expect((["success", "partial", "failed", "blocked"] as const).map(isTerminal)).toEqual([true, true, true, true]);
    expect((["pending", "running"] as const).map(isTerminal)).toEqual([false, false]);
  });
  test("terminal-ok means the node produced usable output", () => {
    expect((["success", "partial"] as const).map(isTerminalOk)).toEqual([true, true]);
    expect((["failed", "blocked"] as const).map(isTerminalOk)).toEqual([false, false]);
  });
});

describe("readySet", () => {
  test("a root node with no parents is runnable", () => {
    const r = readySet([node("a", [], "pending")]);
    expect(r.runnable.map((n) => n.id)).toEqual(["a"]);
    expect(r.blocked).toEqual([]);
  });

  test("a node whose parents all succeeded is runnable", () => {
    const nodes = [node("a", [], "success"), node("b", ["a"], "pending")];
    expect(readySet(nodes).runnable.map((n) => n.id)).toEqual(["b"]);
  });

  test("a node with a still-running parent is neither runnable nor blocked", () => {
    const nodes = [node("a", [], "running"), node("b", ["a"], "pending")];
    const r = readySet(nodes);
    expect(r.runnable).toEqual([]);
    expect(r.blocked).toEqual([]);
  });

  test("a node with a FAILED parent is blocked, never runnable", () => {
    const nodes = [node("a", [], "failed"), node("b", ["a"], "pending")];
    const r = readySet(nodes);
    expect(r.runnable).toEqual([]);
    expect(r.blocked.map((n) => n.id)).toEqual(["b"]);
  });

  test("a partial parent still lets a child run (usable output)", () => {
    const nodes = [node("a", [], "partial"), node("b", ["a"], "pending")];
    expect(readySet(nodes).runnable.map((n) => n.id)).toEqual(["b"]);
  });

  test("one failed parent among several blocks the child even if another parent is ok", () => {
    const nodes = [node("a", [], "success"), node("b", [], "failed"), node("c", ["a", "b"], "pending")];
    expect(readySet(nodes).blocked.map((n) => n.id)).toEqual(["c"]);
  });
});
