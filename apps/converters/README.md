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
bun run build   # napi build --platform --release (host target only),
                # then Bun.build bundles index.ts → dist/ (ESM + CJS)
cargo test      # Rust unit tests: jq/jsonata conversion, formatter, sample
                # types, batch entry points — no build step needed first
```

Published npm releases cover more than the host platform: `.github/workflows/converters-release.yml`
cross-builds a matrix of targets (win32-x64, darwin-x64, darwin-arm64,
linux-x64-gnu today — see `napi.triples.additional` in `package.json`) via
`@napi-rs/cli`, and ships each as its own `optionalDependencies` package
(e.g. `@typeflow/converters-win32-x64-msvc`) so `npm install` only pulls the
one matching the consumer's platform. `index.ts`'s loader tries that
platform package first, falling back to a local `.node` file for the
`bun run build` dev loop above.

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

## Extracting into its own repo

This package is meant to move to `github.com/typeflowx/converters` once that
org exists. Until then, development stays in this monorepo (no need to wire
up real npm dependencies in the meantime — `npm publish` for this package
runs from here via `.github/workflows/converters-release.yml`, tag
`converters-vX.Y.Z`). When it's time to give it a standalone public repo,
mirror its history out with `git subtree` rather than a hard move — that
keeps this monorepo's dev workflow (single PR flow, shared CI) intact:

```sh
git subtree split --prefix=apps/converters -b converters-split
git push <converters-repo-remote> converters-split:main
```
