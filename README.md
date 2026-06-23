# quorum

A multi-agent code-review engine. A planner decomposes a diff into a typed DAG of review tasks, specialist reviewers run in parallel, and an **isolated, refute-biased verifier independently checks every finding** before it ships. The whole thing runs offline, deterministically, with **no API key** — so you can `git clone && bun test` and watch it work in under a minute.

```
diff ─► planner ─► reviewers (parallel, per-concern) ─► verifier (isolated, per-finding) ─► aggregator ─► report + JSONL trace
            │              │                                    │
       picks which    correctness · security ·            tries to REFUTE each
       concerns each   performance · maintainability       finding from only the
       hunk needs      (one class, per-concern rubric)      single hunk it touches
```

This is deliberately **one pattern done properly**, not a framework. The interesting engineering is not "spin up some agents with different prompts" — it's the parts that make a multi-agent system trustworthy and reproducible.

## Why this isn't another toy multi-agent demo

The headline is the **systems rigor you can run**, not the agent count:

1. **It runs offline and deterministically.** Every model call goes through a `LLMProvider` port. The default `ReplayProvider` is a *pure reader* of content-hash-keyed fixtures with **no network client at all** — a cache miss throws because there is nothing else to call. `bun test` passes with no key; CI proves it on a fresh checkout.
2. **Failure handling is first-class.** Per-node status (`success / partial / failed / blocked`), schema-validation retries, refusal handling, and partial-failure aggregation: a dead reviewer leaves a *visible coverage gap* and the run still produces a report that says what failed — it never crashes.
3. **The verifier is measured, not asserted.** A scored eval reports the verifier's impact on **two honest axes** — precision gained *and* recall cost — with a keep-threshold sensitivity sweep, never a single rosy "lift" number.
4. **Typed contracts at every boundary.** Zod is the single source of truth; the Anthropic `json_schema` is *derived* from it, and semantic checks Zod can express but JSON Schema can't (e.g. `lineStart ≤ lineEnd`) drive the retry loop.
5. **Inspectable tracing.** Every node emits a JSONL trace record (model, tokens, latency, status, parents) you can read or post-process.
6. **Variable-topology DAG.** The planner *selects and scopes* concerns per hunk, so the node count and shape depend on the diff — not a hardcoded four-way fan-out.

## Quickstart (offline, no key)

```bash
bun install
bun test                       # 110+ tests, runs with NO ANTHROPIC_API_KEY
bun run typecheck              # strict tsc

bun run review examples/demo.diff   # review a diff (replay mode, offline)
bun run eval                        # scored eval over the dataset (offline)
```

`bun run review` prints a Markdown report to stdout, a readable execution trace to stderr, and writes a JSONL trace to `runs/<runId>.jsonl`.

### Example: `bun run review examples/demo.diff`

The demo diff adds a SQL-injection-prone query, a possible null dereference, and a tempting-but-fine line. Real output (the committed fixtures are recorded from live models — see Provenance):

```
# Code review — run `run-8102fc83`

**Status:** success · **Files:** 1 · **Hunks:** 1
**Cost:** ~$0.0914 (11366 in / 1579 out tokens) · **Latency:** 13ms

## Findings (3 kept)

### 🔴 critical — src/users.ts:11 · security
**SQL Injection via string concatenation**
`id` is concatenated directly into a raw SQL string ... an attacker who controls `id` can break
out of the string literal (e.g. `' OR '1'='1`) to read arbitrary rows ... Because `findUser` is
exported on a public service class, any caller passing unsanitized input reaches this sink.
_Suggested fix:_ Use a parameterised query: `this.db.raw('SELECT * FROM users WHERE id = ?', [id])`.
_Kept by verifier, votes>=2, high-severity · 2 vote(s) · verifier upheld (0.95)_

### 🟠 high — src/users.ts:15–16 · correctness
**Null/undefined dereference on cache miss**
`this.cache.get(id)` may return null/undefined; accessing `user.profile.email` then throws.
_Kept by verifier, high-severity · 1 vote(s) · verifier upheld (0.82)_
```

The planner chose *security* and *correctness* for this hunk (both lenses corroborated the injection → 2 votes), and the reviewers **correctly ignored the tempting-but-fine `items.map(...)` line** — no false positive to drop. The execution trace shows the variable topology — one planner, two reviewers, three verifiers, one aggregator — each with its model tier and token cost.

## Architecture — hexagonal / ports-and-adapters

The domain is pure. It depends only on ports (`LLMProvider`, `Clock`); the Anthropic SDK and all filesystem IO live in adapters at the edges. An **architecture test** greps `src/domain/**` and fails if it imports the SDK, any Node IO builtin, or anything from `adapters/` — the boundary is enforced, not just claimed.

```
src/
├── domain/                  PURE — no SDK, no fs, no wall clock
│   ├── diff/                unified-diff parser + hunk rendering
│   ├── dag/                 node status model + ready-set + capped scheduler
│   ├── schemas/             Zod contracts (the single source of truth)
│   ├── agents/              planner · reviewer · verifier · decideKeep · aggregate
│   ├── orchestrator.ts      wires the pipeline through the scheduler
│   └── ports/               LLMProvider, Clock
├── adapters/
│   ├── llm/                 Anthropic adapter · replay reader · recorder · hashing
│   └── io/                  JSONL trace writer
├── eval/                    matcher · scorer · runner + dataset/
├── render/                  markdown report · trace summary · eval table
└── cli/                     review · eval
```

## Determinism & the replay provider

Reproducibility is the load-bearing claim, so it's structural:

- Each request is hashed with `sha256` over `{model, effort, maxTokens, system, user, schemaJson}` — keys recursively sorted (the derived schema is a nested object), newlines normalised to LF, nothing volatile in the key.
- `record` mode writes `fixtures/llm/<hash>.json`; `replay` mode (the default) reads it, or **throws on a miss**. The replay provider has no Anthropic client, so "never hits the network in CI" is a fact about which code exists, not a runtime flag.
- A dependency bump that re-serialises schemas (e.g. Zod) changes the hash and invalidates fixtures — that's a documented boundary; re-record after such bumps.

Determinism is claimed **honestly**: full run-level reproducibility holds in replay mode. With a live model we claim node-retry *safety* only (nodes are pure over their inputs and commit output only on success), not byte-identical model output.

## The eval

`bun run eval` runs each dataset case through the real pipeline once, then derives every metric by re-applying the pure keep-decision. Real numbers, from the recorded fixtures:

```
| config                       | recall | precision | FP-rate | TP | FP | missed |
|------------------------------|--------|-----------|---------|----|----|--------|
| reviewers only (no verifier) | 100%   | 43%       | 57%     | 3  | 4  | 0      |
| + isolated verifier          | 100%   | 50%       | 50%     | 3  | 3  | 0      |

Verifier impact — precision 43% → 50% (gain), recall 100% → 100% (no cost).
```

A keep-threshold sensitivity sweep (0.5 / 0.6 / 0.7) is reported alongside; here it is flat, so the default threshold isn't doing the heavy lifting — the verifier's refutation is.

**Reading this honestly:** the reviewers found every planted defect (100% recall). The dataset pairs a *real* SQL injection (a user-controlled `name` concatenated into a query) against two look-alike clean cases — a constant table name and a `Number()`-coerced id, both concatenated into SQL but **not** injectable. The verifier **refuted the spurious injection flag on the constant-table case** (recognising the value isn't user-controlled) while correctly keeping the real injection — a genuine precision gain at **zero recall cost**. It did *not* refute every false positive (it upheld a subtler concern on the coerced-id case, and a maintainability note about building SQL by concatenation — both defensible). So the gain is **modest and real, not a staged 100%**: with strong reviewers the verifier's marginal value is real but bounded. That honest, bounded result is exactly what the two-axis harness exists to surface. The dataset is 5 hand-built cases — far too small to be a benchmark; the engineering claim here is the **harness and the systems around it**, not the score.

### Provenance — how the fixtures were made

The committed fixtures are **recorded from live Claude models** (opus-4-8 for planner/verifier, sonnet-4-6 for reviewers) on 2026-06-18, captured through the same content-hash path the replay reader uses, so they replay deterministically with no key. Treat the scoreboard as a worked example of the methodology on real model output, not a measurement of model quality.

To re-record from live calls yourself:

```bash
export ANTHROPIC_API_KEY=...                 # your key
PROVIDER=record bun run review examples/demo.diff   # re-records via the same hash path
PROVIDER=record bun run eval
bun run eval                                 # now replays the freshly recorded responses
```

## Model tiering

Tiering is config, not magic, and the eval reports cost so the tradeoff is legible: planner and verifier (generative, hard to review) run on the strongest model; the bounded, parallel reviewers run on a mid model; trivial routing would run on the cheapest. Pinned IDs (as of build, 2026-06): `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Pricing is approximate and used for relative comparison.

## Limitations / out of scope

- **Reviewers see each hunk plus its surrounding context lines, not the whole file or repo.** Generate the diff with more context (`git diff -U20`) for a wider window. Whole-file and cross-file retrieval are deliberately out of scope.
- Single diff in, single report out; one provider (Anthropic); JSONL persistence only.
- No web UI, no auto-fix application, no AST/semantic analysis, no cost *enforcement* (cost is measured, not capped).

## Tech

TypeScript on [Bun](https://bun.sh) · [Zod](https://zod.dev) v4 (schemas + native JSON Schema) · `@anthropic-ai/sdk` (structured outputs). Strict `tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Built test-first.

## License

MIT
