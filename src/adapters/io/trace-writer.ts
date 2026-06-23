import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TraceRecord } from "../../domain/schemas/trace.ts";

/** Serialise a trace as JSONL — one record per line. Pure. */
export function renderJsonl(trace: TraceRecord[]): string {
  return trace.length === 0 ? "" : `${trace.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

/** Write the trace to a `.jsonl` file, creating parent directories as needed. */
export function writeTrace(path: string, trace: TraceRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderJsonl(trace));
}
