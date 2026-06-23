/**
 * Per-node lifecycle status.
 *
 * - pending  — not yet started
 * - running  — exec in flight
 * - success  — produced a valid output
 * - partial  — produced usable output but a sub-part failed (run continues)
 * - failed   — retries exhausted / non-retryable / timeout
 * - blocked  — a required parent failed, so this node was never run
 *
 * success/partial are "terminal-ok" (usable output → children may run);
 * failed/blocked are terminal failures (children become blocked).
 */
export type NodeStatus = "pending" | "running" | "success" | "partial" | "failed" | "blocked";

const TERMINAL = new Set<NodeStatus>(["success", "partial", "failed", "blocked"]);
const TERMINAL_OK = new Set<NodeStatus>(["success", "partial"]);

export function isTerminal(s: NodeStatus): boolean {
  return TERMINAL.has(s);
}

export function isTerminalOk(s: NodeStatus): boolean {
  return TERMINAL_OK.has(s);
}

export function isTerminalFailure(s: NodeStatus): boolean {
  return s === "failed" || s === "blocked";
}
