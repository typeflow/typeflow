# Runtime optimization — compiling to closures

> **Status: steps 1 and 2 shipped (2026-07-08).** The production runtime
> (`src/runtime/compile.ts`, wired into `createMapping`/`runMapping`)
> compiles the IR once into nested closures, **and** statically resolves
> identifiers when the checker can prove them stable at runtime. The old
> tree-walker (`src/runtime/interpreter.ts`) stays in the repo as a
> reference implementation, compared against `compile.ts` by
> `test/runtime-equivalence.test.ts` (benchmark scenarios + targeted
> cases: let/field shadowing, `-> l, i` binders, optional fields, index
> scopes). Up-to-date figures in `benchmarks/<date>/result.md`, generated
> by `bun run bench` and published to the docs by `bun run bench:publish`.

_Initial report from 2026-07-04, updated 2026-07-08 after implementation.
Measurements taken on this machine (Bun 1.3.13, Windows x64), scenarios
from `scripts/bench/scenarios.ts` (the same ones as the /benchmark
page)._

## Starting point

The interpreter (`src/runtime/interpreter.ts`) is a tree-walker: the IR
is fully re-traversed on every execution of the mapping.

Gap measured against a hand-written JS function, before any
optimization:

| Scenario         | interpreter | native JS     | gap       |
| ---------------- | ----------- | ------------- | --------- |
| reshape, n=10    | 383 k ops/s | 8,400 k ops/s | **×21.9** |
| reshape, n=1000  | 13.1 k      | 90.2 k        | **×6.9**  |
| catalog, n=10    | 109 k       | 1,141 k       | **×10.5** |
| catalog, n=1000  | 1.7 k       | 17.6 k        | **×10.2** |

## Where the time went (in `interpreter.ts`)

1. **`switch` dispatch per node, on every call** — `evalExpr` re-decides
   the nature of each node on every execution.
2. **Per-element allocations**:
   - `filter` / `project` / `sort` allocate an `Env` per element;
     `project` additionally allocates a `bindings` object even with no
     binder (`bindEnv`).
   - `evalObject` allocates **two objects** per produced object:
     `Object.create(null)` then re-wraps with `{ ...out }` — per element
     inside a projection.
3. **Dynamic `lookup()`**: each identifier walks up the `Env` chain with
   `Object.hasOwn` at every level — inside a filter predicate, that's
   per element.
4. **Work that's redoable once but redone on every call**:
   `parentChainDepth()` recomputed per `member` node; `call` walks up
   envs (functions/defs) then checks `BUILTINS` on every call;
   `expr.args.map(...)` allocates on every call.

## Step 1 — compile the IR into closures (WITHOUT eval)

**Shipped in `src/runtime/compile.ts`.** A single pass in `createMapping`
turns every node into a nested JS function:

```ts
type Op = (env: Env) => unknown;
function compileExpr(e: Expr): Op {
  switch (e.kind) {
    case 'lit': { const v = e.value; return () => v; }
    case 'member': { const o = compileExpr(e.object); const n = e.name;
                     return (env) => member(o(env), n); }
    // … the switch only runs ONCE, at preparation time
  }
}
```

Everything statically decidable is resolved at preparation time:
dispatch, `parentChainDepth`, whether a binder is present, the property
list, call arity, the call target (builtin / `fn` / external, frozen
into the closure), and whether a dangerous key (`__proto__`) is present
in an object literal (otherwise writing directly into a `{}`, without
the interpreter's double-allocation `Object.create(null)` + `{ ...out }`).
Execution is now nothing but direct function calls.

**Properties preserved** (this is the key point vs. `new Function`):

- no `eval` / `new Function` → strict CSP OK, sandbox intact;
- the JSON artifact (`CompiledMapping` v1) is unchanged;
- the public API (`createMapping`, `runMapping`) is unchanged;
- determinism and the depth limit are unchanged.

## Step 2 — static resolution of identifiers

**Shipped.** The checker (`src/compiler/checker.ts`) annotates every
`IdentExpr` in the IR with its resolution (`IdentRes`, optional `res`
field — v1 artifact stays backward-compatible):

- `{ kind: 'var', hops }` — a binding (`let`, `fn` parameter, input) at
  `hops` scope levels above;
- `{ kind: 'field', hops }` — an element field (filter, `->`, sort) at
  `hops` levels, non-optional;
- `{ kind: 'dyn' }` — the resolution isn't guaranteed stable at runtime:
  optional field (could be absent and fall back to an outer scope), an
  `any`/union/array/mixed-primitive element on the path (the dynamic
  `hasOwn` could still match on it), resolutions that diverge between
  two re-checks of the same body on different parts of a union, or an
  index scope from `[...]` (the element is `undefined` there at runtime
  even though the checker types it to validate the expression).

The runtime (`src/runtime/compile.ts`) compiles an annotated identifier
into a direct read at a known depth (a single `Object.hasOwn`, with the
same guards as the dynamic lookup — no reading off arrays or the
prototype) instead of walking the full `Env` chain. Unannotated (or
`dyn`) identifiers keep the unchanged dynamic lookup: a safe fallback,
never an error case.

The point that makes this correct: **the checker's scope chain and the
runtime's `Env` chain are aligned 1:1**, scope by scope (root,
filter/index/sort elements, `->` scopes, `let` blocks, `fn` bodies) — a
`hops` count computed on the checker side designates exactly the same
level on the runtime side.

## Measured gain (shipped implementation, bit-for-bit identical output)

Comparison of the interpreter (`interpreter.ts`, reference) against the
shipped compiled runtime (`compile.ts`, closures + static identifier
resolution):

| Scenario          | interpreter  | closures + static | **gain** | remaining vs. native |
| ------------------ | ------------ | ------------------ | -------- | --------------------- |
| reshape, n=10      | 414 k ops/s  | 1,090 k            | **×2.6** | ×8.0 (n=10)           |
| reshape, n=1000    | 13.6 k       | 28.4 k             | **×2.1** | ×1.4 (n=1000)         |
| reshape, n=10000   | 1.4 k        | 2.8 k              | **×2.0** | ×2.1 (n=10000)        |
| catalog, n=10      | 122 k        | 375 k              | **×3.1** | ×3.8 (n=10)           |
| catalog, n=1000    | 1.6 k        | 5.1 k              | **×3.2** | ×3.5 (n=1000)         |
| catalog, n=10000   | 160          | 502                | **×3.1** | ×2.8 (n=10000)        |

"Remaining vs. native" columns recomputed from
`benchmarks/2026-07-08/result.md` (see that file for exact figures,
including JSONata and jq). Figures to refresh on every `bun run bench`.

The gain from static resolution (step 2 alone, relative to step 1 alone)
is more pronounced on `catalog` — two filter predicates per mapping,
exactly the hot spot targeted — than on `reshape`, which has one filter
and less scope depth.

## Next steps (in order of return)

1. ~~**Compile to closures**~~ — shipped (above).
2. ~~**Static resolution of identifiers**~~ — shipped (above).
3. ~~**`evalObject` without double allocation**~~ — shipped as part of
   step 1 (`__proto__` decision frozen at compile time).
4. ~~**Resolving calls at preparation time**~~ — shipped as part of
   step 1 (builtin/def/external target frozen into the closure).
5. **Operator fusion** (optional, to evaluate if the need persists) —
   `sum(arr[pred].price)` in one pass with no intermediate arrays;
   `arr[pred] -> {…}` filter+map fused. Compiler-side work (IR
   rewriting). The remaining gap vs. native (×1.4 to ×8 depending on
   scenario and size, see table above) mostly comes from the
   per-projected-element object allocation and the intermediate arrays
   of `filter`/`project` — what this step would target.

## What NOT to do

- **`new Function` codegen**: even faster, but breaks the sandbox/CSP
  argument that's a pillar of the positioning ("deterministic and
  sandboxable by construction"). If ever considered, it must be an
  explicit opt-in mode, never the default.

## Validation

- The test suite (164 tests, `bun test`) covers runtime behavior and
  passes with no API change.
- `test/runtime-equivalence.test.ts` compares `interpreter.ts` and
  `compile.ts` output for output (benchmark scenarios + shadowing/
  binders/optional fields/index) — the non-regression guarantee as long
  as both implementations coexist.
- The docs' **/benchmark** page and `bun run bench` reflect the gain
  immediately (they recompile on every run).
</content>
