# quorum

A multi-agent code-review engine. A planner splits a diff into a typed DAG of review tasks, specialist reviewers run in parallel, and a separate verifier tries to refute every finding before it reaches the report. It runs offline and deterministically with no API key, so `git clone && bun install && bun test` works in under a minute.

```
diff ─► planner ─► reviewers (parallel, per-concern) ─► verifier (isolated, per-finding) ─► aggregator ─► report + JSONL trace
            │              │                                    │
       picks which    correctness · security ·            tries to REFUTE each
       concerns each   performance · maintainability       finding from only the
       hunk needs      (one class, per-concern rubric)      single hunk it touches
```

It implements one pattern (planner, reviewers, verifier) and puts the work into the parts that make a multi-agent system reproducible and measurable.

## What it does

1. **Runs offline and deterministically.** Every model call goes through an `LLMProvider` port. The default `ReplayProvider` reads content-hash-keyed fixtures and has no network client, so a cache miss throws. `bun test` passes with no key, and CI runs it on a fresh checkout with no secrets configured.
2. **Handles failure per node.** Each node ends as `success`, `partial`, `failed` or `blocked`. Schema-validation errors are retried, refusals are handled, and a dead reviewer shows up in the report as a coverage gap instead of crashing the run.
3. **Measures the verifier.** The eval reports what the verifier does to precision and to recall, plus a keep-threshold sensitivity sweep.
4. **Types every boundary.** Zod schemas are the single source of truth. The Anthropic `json_schema` is derived from them, and checks JSON Schema can't express (such as `lineStart ≤ lineEnd`) feed the retry loop.
5. **Traces every node.** Each node writes a JSONL record with model, tokens, latency, status and parents.
6. **Builds the DAG from the diff.** The planner chooses and scopes concerns per hunk, so the number and shape of nodes depend on the diff.

## Quickstart (offline, no key)

```bash
bun install
bun test                       # 114 tests, no ANTHROPIC_API_KEY needed
bun run typecheck              # strict tsc

bun run review examples/demo.diff   # review a diff (replay mode, offline)
bun run eval                        # scored eval over the dataset (offline)
```

`bun run review` prints a Markdown report to stdout, a readable execution trace to stderr, and writes a JSONL trace to `runs/<runId>.jsonl`.

### Example: `bun run review examples/demo.diff`

The demo diff adds a SQL-injection-prone query, a possible null dereference, and a line that looks suspicious but is fine. This is the real output from the committed fixtures (recorded from live models, see Provenance), trimmed:

```
# Code review — run `run-8102fc83`

**Status:** success · **Files:** 1 · **Hunks:** 1
**Cost:** ~$0.0843 (11366 in / 1284 out tokens) · **Latency:** 13ms

## Findings (2 issues, from 3 kept findings)

### 🔴 critical — src/users.ts:11 · security + correctness
**SQL Injection via string concatenation**
The `id` parameter is concatenated directly into a raw SQL string without any sanitization or
parameterization. An attacker who controls `id` can break out of the string literal ...
_Suggested fix:_ Use a parameterized query: `this.db.raw('SELECT * FROM users WHERE id = ?', [id])` ...
_Kept by verifier, votes>=2, high-severity · 2 vote(s) · verifier upheld (0.97) · reported by 2 reviewers, shown once_

### 🟠 high — src/users.ts:15–16 · correctness
**Null/undefined dereference when cache miss returns null or undefined**
`this.cache.get(id)` may return `null` or `undefined` if the key is absent ...
_Kept by verifier, high-severity · 1 vote(s) · verifier upheld (0.90)_
```

The planner chose security and correctness for this hunk. Both reviewers flagged the injection, which gives it two votes; the report shows it once. Neither reviewer flagged the harmless `items.map(...)` line. The trace shows one planner, two reviewers, three verifiers and one aggregator, each with its model tier and token cost. Cost is what the recorded calls would cost live. Latency is replay time, since nothing hits the network.

## Architecture: ports and adapters

The domain depends only on ports (`LLMProvider`, `Clock`). The Anthropic SDK and all filesystem IO live in adapters. An architecture test scans `src/domain/**` and fails if it imports the SDK, a Node IO builtin, or anything from `adapters/`.

```
src/
├── domain/                  PURE: no SDK, no fs, no wall clock
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

## Determinism and the replay provider

- Each request is hashed with `sha256` over `{model, effort, maxTokens, system, user, schemaJson}`. Keys are sorted recursively, newlines are normalised to LF, and nothing volatile goes into the key.
- `record` mode writes `fixtures/llm/<hash>.json`. `replay` mode (the default) reads it or throws on a miss. The replay provider has no Anthropic client, so it cannot reach the network in CI.
- A dependency bump that re-serialises schemas (Zod, for example) changes the hash and invalidates fixtures. Re-record after such bumps.

Full run-level reproducibility holds in replay mode. With a live model, nodes are pure over their inputs and only commit output on success, so retrying a node is safe, but model output will differ between runs.

## The eval

`bun run eval` runs each dataset case through the pipeline once, then computes every metric by re-applying the pure keep-decision. Numbers from the recorded fixtures:

```
| config                       | recall | precision | FP-rate | TP | FP | missed |
|------------------------------|--------|-----------|---------|----|----|--------|
| reviewers only (no verifier) | 100%   | 43%       | 57%     | 3  | 4  | 0      |
| + isolated verifier          | 100%   | 50%       | 50%     | 3  | 3  | 0      |

Verifier impact: precision 43% → 50% (gain), recall 100% → 100% (no cost).
```

The keep-threshold sweep (0.5 / 0.6 / 0.7) is flat on this data, so the gain comes from the verifier's refutations rather than the threshold.

The reviewers found every planted defect. The dataset pairs a real SQL injection (a user-controlled `name` concatenated into a query) with two clean look-alikes: a constant table name and a `Number()`-coerced id, both concatenated into SQL but not injectable. The verifier refuted the injection flag on the constant-table case and kept the real one. It upheld a concern on the coerced-id case and a maintainability note about building SQL by concatenation, both defensible. The dataset is 5 hand-built cases, far too small to be a benchmark. What this repo shows is the harness; growing the dataset with real bugs from public repos is the next step.

### Provenance: how the fixtures were made

The committed fixtures were recorded from live Claude models (opus-4-8 for planner and verifier, sonnet-4-6 for reviewers) on 2026-06-18, through the same content-hash path the replay reader uses. Treat the scoreboard as a worked example of the method on real model output, not as a measure of model quality.

To re-record from live calls:

```bash
export ANTHROPIC_API_KEY=...                 # your key
PROVIDER=record bun run review examples/demo.diff   # re-records via the same hash path
PROVIDER=record bun run eval
bun run eval                                 # replays the freshly recorded responses
```

## Model tiering

Tiering is config. The planner and verifier run on the strongest model because their output is hardest to check. The parallel, bounded reviewers run on a mid-tier model, and trivial routing would use the cheapest. Pinned IDs as of June 2026: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Pricing is approximate and used to compare configurations.

## Limitations

- Reviewers see each hunk plus its context lines, not the whole file or repo. Generate the diff with more context (`git diff -U20`) for a wider window. Whole-file and cross-file retrieval are out of scope.
- One diff in, one report out. One provider (Anthropic). JSONL persistence only.
- No web UI, no auto-fix, no AST or semantic analysis. Cost is measured, not capped.

## Tech

TypeScript on [Bun](https://bun.sh) · [Zod](https://zod.dev) v4 (schemas + native JSON Schema) · `@anthropic-ai/sdk` (structured outputs). Strict `tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Built test-first.

## License

MIT
