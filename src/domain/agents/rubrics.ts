import type { Concern } from "../schemas/common.ts";

/**
 * Per-concern review guidance. This is what makes the reviewer one
 * concern-PARAMETERISED class rather than four prompt-only clones: each instance
 * gets a genuinely different lens and severity bar.
 */
export const CONCERN_RUBRICS: Record<Concern, string> = {
  correctness:
    "Focus on logic that is wrong: off-by-one and boundary errors, inverted or wrong operators, " +
    "null/undefined dereferences, unhandled error paths, incorrect async/await or promise handling, " +
    "race conditions, and edge cases the change forgets. A bug that produces a wrong result is high/critical.",
  security:
    "Focus on exploitable weaknesses: injection (SQL/command/template), missing authentication/authorization checks, " +
    "hardcoded secrets, unsafe deserialization, path traversal, SSRF, and unvalidated or untrusted input " +
    "reaching a sink. Tie each finding to a concrete attack path. A reachable vulnerability is high/critical.",
  performance:
    "Focus on changes that make hot paths slower: N+1 queries, accidental O(n^2), unnecessary allocations or " +
    "copies, blocking I/O on a hot path, missing memoisation, and large synchronous work. Prefer findings with " +
    "a plausible real cost; micro-optimisations are low/info.",
  maintainability:
    "Focus on changes that will cost future readers: unclear names, duplicated logic, dead code, tangled control " +
    "flow, missing or wrong types, magic numbers, and functions doing too much. These are usually low/medium " +
    "unless they actively invite bugs.",
};
