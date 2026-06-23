import type { Hunk } from "./diff.types.ts";

/**
 * Render a hunk as the text a reviewer sees: the changed lines PLUS their
 * surrounding context (the `-U`-style window), each tagged with its NEW-file
 * line number so the model cites locations the report can resolve. Deleted
 * lines have no new-file number and are shown with a `·` placeholder.
 */
export function renderHunkWindow(file: string, hunk: Hunk): string {
  const header =
    `File: ${file}\n` +
    `Hunk: ${hunk.header}\n` +
    `Lines show NEW-file line numbers; + added, - removed, space unchanged.\n`;
  const body = hunk.lines
    .map((line) => {
      const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      const num = line.newLineNo === null ? "   ·" : String(line.newLineNo).padStart(4, " ");
      return `${num} ${marker} ${line.content}`;
    })
    .join("\n");
  return header + body;
}
