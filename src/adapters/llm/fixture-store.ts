import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedRequest } from "./request-hash.ts";

/**
 * The recorded side of one LLM call. `request` is stored for human auditing
 * (open a fixture, read the exact prompt); the hash filename is the lookup key.
 * `model`, `stopReason` and `recordedAt` make the eval's provenance claim
 * honest ("recorded from <model> on <date>") — they live in the VALUE, never
 * the key (a timestamp in the key would break determinism).
 */
export interface FixtureResponse {
  readonly raw: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly model: string;
  readonly stopReason: string;
  readonly latencyMs: number;
  readonly recordedAt: string;
}

export interface Fixture {
  readonly request: ResolvedRequest;
  readonly response: FixtureResponse;
}

export function fixturePath(dir: string, hash: string): string {
  return join(dir, `${hash}.json`);
}

export function readFixture(dir: string, hash: string): Fixture | null {
  const path = fixturePath(dir, hash);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export function writeFixture(dir: string, hash: string, fixture: Fixture): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fixturePath(dir, hash), `${JSON.stringify(fixture, null, 2)}\n`);
}
