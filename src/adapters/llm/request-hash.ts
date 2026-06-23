import { createHash } from "node:crypto";

/** A fully-resolved request: everything that determines the model's output. */
export interface ResolvedRequest {
  readonly model: string;
  readonly effort: string;
  readonly maxTokens: number;
  readonly system: string;
  readonly user: string;
  /** The derived JSON Schema — a nested object whose key order is NOT stable. */
  readonly schemaJson: Record<string, unknown>;
}

/** Recursively sort object keys so serialization is order-independent. */
function canonicalValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function canonicalize(v: unknown): string {
  return JSON.stringify(canonicalValue(v));
}

/** CRLF (and lone CR) → LF, so a prompt hashes the same on any platform. */
function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/**
 * Content hash of a request, used as the replay-fixture filename. Keyed ONLY on
 * fields that determine the output — model, effort, maxTokens, system, user, and
 * the (recursively key-sorted) JSON Schema. Nothing volatile (no timestamps, no
 * runId, no paths) enters the key, so the same logical call always maps to the
 * same fixture across runs and clones.
 *
 * NOTE: the key includes the derived schema, so a dependency bump that
 * re-serializes schemas (e.g. zod) invalidates fixtures — re-record after such
 * bumps. That is a documented boundary, not a latent bug.
 */
export function requestHash(r: ResolvedRequest): string {
  const canonical = canonicalize({
    model: r.model,
    effort: r.effort,
    maxTokens: r.maxTokens,
    system: normalizeNewlines(r.system),
    user: normalizeNewlines(r.user),
    schemaJson: r.schemaJson,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
