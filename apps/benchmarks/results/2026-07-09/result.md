---
title: Benchmark — 2026-07-09
---

# Benchmark — 2026-07-09

_Measured on: Bun 1.3.13, win32 x64. Scenarios from `scripts/bench/scenarios.ts` — the same ones the docs' [/benchmark page](/benchmark) uses. All four implementations are checked to produce identical output (JSON) before any number is measured. Each engine is compiled/parsed once; the numbers compare per-call execution._

## Implementations compared

| Engine | Version | Detail |
|---|---|---|
| **Typeflow** | v0.0.1 | `createMapping` over the compiled artifact — closure-compiling runtime (`src/runtime/compile.ts`), no `eval`/`new Function` |
| **jq** | v1.8.2 (WASM) | REAL jq (the C codebase, compiled to WebAssembly by `jq-wasm`), run in-process — a spawned jq binary would only measure process startup. Includes the JSON round-trip to the WASM module, inherent to this execution mode |
| **JSONata** | v2.2.1 | `jsonata(expr).evaluate(input)` — asynchronous API, the promise overhead is included (inherent to its API) |
| **Native JS** | — | the hand-written function: the ceiling, zero interpretation |

## Typeflow vs JSONata

On this machine, Typeflow runs these scenarios **×48.1 to ×76.9** faster than JSONata.

![Typeflow throughput relative to JSONata, by scenario and size](./ratio.svg)

## Scenario `reshape` — Reshape an API response

Paths, optional access with a default, comparison, string concatenation, a filter and an aggregate — the everyday mapping.

| n | Typeflow | jq | JSONata | Native JS | Typeflow vs JSONata | vs native |
|---|---|---|---|---|---|---|
| 10 | 806.9 k ops/s | 364 ops/s | 15.7 k ops/s | 4.18 M ops/s | **×51.2** | ×5.2 |
| 1,000 | 25.6 k ops/s | 182 ops/s | 470 ops/s | 79.8 k ops/s | **×54.4** | ×3.1 |
| 10,000 | 2.1 k ops/s | 16 ops/s | 44 ops/s | 6.2 k ops/s | **×48.1** | ×2.9 |

_Bars are normalized per size group (the group's max = full width): sizes differ by orders of magnitude, a shared axis would flatten everything. Exact values are on each bar._

![Throughput by engine, scenario reshape](./reshape.svg)

## Scenario `catalog` — Filter, project, aggregate

A product catalog: count and sum over a filtered array, then a projection with a function call — the array-heavy path.

| n | Typeflow | jq | JSONata | Native JS | Typeflow vs JSONata | vs native |
|---|---|---|---|---|---|---|
| 10 | 346.8 k ops/s | 460 ops/s | 5.2 k ops/s | 1.56 M ops/s | **×66.5** | ×4.5 |
| 1,000 | 3.0 k ops/s | 31 ops/s | 45 ops/s | 19.5 k ops/s | **×66.2** | ×6.6 |
| 10,000 | 479 ops/s | 5 ops/s | 6 ops/s | 1.8 k ops/s | **×76.9** | ×3.8 |

_Bars are normalized per size group (the group's max = full width): sizes differ by orders of magnitude, a shared axis would flatten everything. Exact values are on each bar._

![Throughput by engine, scenario catalog](./catalog.svg)

## Reading the numbers

- The Typeflow runtime is **compiled into closures**: the IR is walked once at preparation, not on every call. Identifier reads are **statically resolved** where the checker can prove it's safe: a direct read at a known scope depth instead of a full dynamic walk. Filters are **fused with their consumer**: `arr[pred] -> {…}`, `arr[pred].name` and `sum`/`count` over them run as one pass, without the intermediate arrays. The gap remaining vs native is mostly the per-element object allocation of projections.
- Microbenchmark: synthetic data, indicative ratios, not absolute.
- Raw data: [`results.json`](./results.json).

## Reproducing

```sh
bun run bench          # writes benchmarks/<date>/
bun run bench:publish  # publishes the reports into the docs (docs/benchmarks/)
```
