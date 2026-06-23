import type { TraceRecord } from "../domain/schemas/trace.ts";

/**
 * Render the execution trace as readable, flat lines — one per node. The fancy
 * indented tree view is a possible extension; this is the inspectable baseline.
 */
export function renderTraceSummary(trace: TraceRecord[]): string {
  return trace
    .map((r) => {
      const tokens = r.tokens ? `${r.tokens.input}/${r.tokens.output}tok` : "—";
      const target = r.target ? ` ${r.target.file}#${r.target.hunkIndex}` : "";
      const model = r.model ?? "—";
      const err = r.error ? ` · ERROR: ${r.error}` : "";
      return `[${r.status}] ${r.type} ${r.nodeId}${target} · ${model} · ${tokens} · ${r.latencyMs}ms${err}`;
    })
    .join("\n");
}
