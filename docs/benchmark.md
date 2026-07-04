---
aside: false
outline: false
---

<div class="tf-wide"></div>

# Benchmark

Same transformation, three engines, measured **in your browser, on your machine** — no pre-baked numbers. Each scenario is written as a Typeflow mapping, an equivalent JSONata expression, and a hand-written JavaScript function (the native ceiling). Pick an array size, hit run, and compare.

Two guarantees before any number is shown:

- **The three implementations produce identical output.** This is checked when these docs are built (a mismatch fails the build) _and_ re-checked in your browser right before each run.
- **One-time costs are separated.** Typeflow is compiled once and JSONata parsed once — what the bars compare is per-call execution, which is what matters when a mapping runs on every request. The one-time cost is reported under the results.

<ClientOnly><Benchmark /></ClientOnly>

## Fine print

- This is a **microbenchmark**: it measures these transformations on synthetic data, not your workload. Treat the ratios as indicative, not absolute.
- The timing loop is adaptive (≈250 ms of _active_ time per engine, after warmup) and yields to the UI between batches — idle time is excluded from the math.
- JSONata v2's `evaluate()` is asynchronous, so its numbers include the promise overhead inherent to its API. Typeflow's runtime and the native function are synchronous.
- Results vary with your hardware, browser and current load. Run it a few times.
- The hand-written function is the fair upper bound: it does exactly the work with zero interpretation. Typeflow's interpreter walks a compiled IR; the gap to native is the price of a serializable, sandboxable artifact.
