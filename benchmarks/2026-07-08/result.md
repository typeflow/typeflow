---
title: Benchmark — 2026-07-08
---

# Benchmark — 2026-07-08

_Measured on: Bun 1.3.13, win32 x64. Scenarios from `scripts/bench/scenarios.ts` — the same ones the docs' [/benchmark page](/benchmark) uses. All four implementations are checked to produce identical output (JSON) before any number is measured. Each engine is compiled/parsed once; the numbers compare per-call execution._

## Implementations compared

| Engine | Version | Detail |
|---|---|---|
| **Typeflow** | v0.0.1 | `createMapping` over the compiled artifact — closure-compiling runtime (`src/runtime/compile.ts`), no `eval`/`new Function` |
| **jq** | v1.8.2 (WASM) | REAL jq (the C codebase, compiled to WebAssembly by `jq-wasm`), run in-process — a spawned jq binary would only measure process startup. Includes the JSON round-trip to the WASM module, inherent to this execution mode |
| **JSONata** | v2.2.1 | `jsonata(expr).evaluate(input)` — asynchronous API, the promise overhead is included (inherent to its API) |
| **Native JS** | — | the hand-written function: the ceiling, zero interpretation |

## Typeflow vs JSONata

On this machine, Typeflow runs these scenarios **×42.2 to ×70.2** faster than JSONata.

![Typeflow throughput relative to JSONata, by scenario and size](./ratio.svg)

## Scenario `reshape` — Reshape an API response

Paths, optional access with a default, comparison, string concatenation, a filter and an aggregate — the everyday mapping.

| n | Typeflow | jq | JSONata | Native JS | Typeflow vs JSONata | vs native |
|---|---|---|---|---|---|---|
| 10 | 849.6 k ops/s | 455 ops/s | 20.1 k ops/s | 6.82 M ops/s | **×42.2** | ×8.0 |
| 1,000 | 37.2 k ops/s | 268 ops/s | 638 ops/s | 50.5 k ops/s | **×58.3** | ×1.4 |
| 10,000 | 1.8 k ops/s | 17 ops/s | 25 ops/s | 3.8 k ops/s | **×70.2** | ×2.1 |

_Bars are normalized per size group (the group's max = full width): sizes differ by orders of magnitude, a shared axis would flatten everything. Exact values are on each bar._

![Throughput by engine, scenario reshape](./reshape.svg)

## Scenario `catalog` — Filter, project, aggregate

A product catalog: count and sum over a filtered array, then a projection with a function call — the array-heavy path.

| n | Typeflow | jq | JSONata | Native JS | Typeflow vs JSONata | vs native |
|---|---|---|---|---|---|---|
| 10 | 280.5 k ops/s | 350 ops/s | 5.5 k ops/s | 1.42 M ops/s | **×51.0** | ×5.1 |
| 1,000 | 3.5 k ops/s | 44 ops/s | 60 ops/s | 17.8 k ops/s | **×57.6** | ×5.1 |
| 10,000 | 353 ops/s | 4 ops/s | 6 ops/s | 992 ops/s | **×58.2** | ×2.8 |

_Bars are normalized per size group (the group's max = full width): sizes differ by orders of magnitude, a shared axis would flatten everything. Exact values are on each bar._

![Throughput by engine, scenario catalog](./catalog.svg)

## Reading the numbers

- The Typeflow runtime is **compiled into closures** (step 1 of `explore/optimisation-runtime.md`): the IR is walked once at preparation, not on every call. Identifier reads are also **statically resolved** where the checker can prove it's safe (step 2): a direct read at a known scope depth instead of a full dynamic walk. The gap remaining vs native is mostly the interpretive overhead that's left after both steps — see the study for what's next.
- Microbenchmark: synthetic data, indicative ratios, not absolute.
- Raw data: [`results.json`](./results.json).

## Reproducing

```sh
bun run bench          # writes benchmarks/<date>/
bun run bench:publish  # publishes the reports into the docs (docs/benchmarks/)
```
