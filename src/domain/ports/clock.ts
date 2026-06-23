/**
 * Time source. Injected so latency is deterministic in tests and replay — the
 * domain never reads the wall clock directly (that would break reproducibility).
 */
export interface Clock {
  /** Current time in milliseconds. */
  now(): number;
}
