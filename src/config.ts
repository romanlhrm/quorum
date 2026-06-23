import type { KeepConfig } from "./domain/agents/decide-keep.ts";

/** Keep-rule defaults — precision-biased (see decideKeep). */
export const DEFAULT_KEEP: KeepConfig = { confidenceThreshold: 0.6, voteFloor: 2 };

/** Max nodes the scheduler runs at once. */
export const DEFAULT_CONCURRENCY = 6;

/** Where committed replay fixtures live. */
export const DEFAULT_FIXTURES_DIR = "fixtures/llm";
