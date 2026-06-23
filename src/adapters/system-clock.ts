import type { Clock } from "../domain/ports/clock.ts";

/** Wall-clock time. Used in live/record runs; replaced by a fake in tests/replay. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
