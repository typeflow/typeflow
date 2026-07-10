# @typeflow/converters

The Typeflow converters (jq → Typeflow, JSONata → Typeflow) rewritten in
Rust and exposed as a native Node.js addon (`.node`, via napi-rs), behind a
typed TypeScript wrapper. Originally a port of `src/converter` from the main
`typeflow` package — including the Typeflow parser and canonical formatter
the converters rely on — now the only implementation; covered by `cargo
test` unit tests on the Rust conversion logic itself (parser → emit →
formatter, per language, plus the parallel batch entry points).

Lives in `apps/` because it is meant to be extracted into its own package
later: it has no source dependency on the monorepo at all.

## API

Same surface as the TypeScript converters:

```ts
import {
  convertJq,
  convertJqBatch,
  convertJsonata,
  formatTypeflow,
  typeFromSample,
} from '@typeflow/converters';

convertJq('{ id: .id, name: .user.name }');
convertJsonata('{ "fullName": firstName & " " & lastName }', {
  inputName: 'user',
  input: { sample: { firstName: 'Ada', lastName: 'Lovelace' } },
});
// → { ok, typeflow, notes, errors }

// convertJqBatch/convertJsonataBatch convert many sources in one native call,
// in parallel across CPU cores (Rust/rayon) — use these for multi-file work
// instead of looping over convertJq/convertJsonata one file at a time.
convertJqBatch(['{ a: .x }', '{ b: .y }']);
// → ConvertResult[]
```

## Build

Requires Bun and a Rust toolchain (edition 2021).

```sh
bun run build   # cargo build --release, copies the platform .node,
                # then Bun.build bundles index.ts → dist/ (ESM + CJS)
cargo test      # Rust unit tests: jq/jsonata conversion, formatter, sample
                # types, batch entry points — no build step needed first
```

## Layout

| Path               | Role                                                       |
| ------------------ | ---------------------------------------------------------- |
| `index.ts`         | Typed wrapper: loads the addon, adapts the TS option shape |
| `scripts/build.ts` | Bun build script (cargo + `Bun.build` ESM/CJS)             |
| `src/tf/`          | Rust: Typeflow lexer, parser, AST, canonical formatter     |
| `src/jq/`          | Rust: jq parser, input-type inference, emission            |
| `src/jsonata/`     | Rust: JSONata parser, input-type inference, emission       |
| `src/sample.rs`    | Rust: `typeFromSample` (JSON sample → inline type)         |
| `src/util.rs`      | Rust: JS-compatible number formatting, JSON quoting        |

Parity notes: number formatting reproduces ECMAScript `String(number)`
(shortest round-trip plus ECMA-262 exponent layout), string quoting matches
`JSON.stringify`, inline-width decisions in the formatter measure UTF-16
lengths like JS `String.length`, and object-key iteration preserves insertion
order (serde_json `preserve_order`).
