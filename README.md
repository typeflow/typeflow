# Typeflow

> **Typed JSON transformations. Checked at compile time.**

Typeflow is a declarative mapping language for JSON with first-class TypeScript typing — validated paths, inferred output types, and compile-time errors for your data transformations.

**[▶ Try it in the Playground](https://thomasfarineau.github.io/typeflow/playground)** · [Documentation](https://thomasfarineau.github.io/typeflow/)

You've written this function a hundred times: take the API's JSON, reshape it into the type your app wants. It's boring, it's error-prone, and when the API changes, TypeScript can't tell you which of your forty mapping functions just broke. JSONata and jq make the transformation declarative — but invisible to your compiler. Typeflow makes it declarative _and_ typed: paths autocomplete, typos are compile errors, output types are inferred, and your mappings are artifacts you can test, diff, and trust.

```
Input JSON shape → .typeflow mapping file → Typed output shape
```

## A 30-second look

`user.typeflow` — the mapping body mirrors the output shape; leaves are expressions over the input:

```
input user: ApiUser from "./user-types"

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  isAdmin: user.role == "admin",
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
  address: user.address -> {
    city: city,
    country: country ?? "unknown",
  },
}
```

Typo in a path? That's a **compile error**, not a production incident:

```
user.typeflow:4:11 - error TF2002: Property 'emial' does not exist on type
'{ email: string; contact?: { phone: string } }'. Did you mean 'email'?

4    mail: u.emial,
             ~~~~~

user.typeflow:5:20 - error TF2003: Object is possibly 'undefined'.

5    phone: u.contact.phone,
                      ~~~~~
  hint: Use the optional access operator: '?.phone', or provide a default with '??'.
```

And the output type is **inferred**, not hand-written:

```console
$ typeflow infer user.typeflow
{
  id: number;
  fullName: string;
  isAdmin: boolean;
  email: string;
  activeTags: string[];
  address: { city: string; country: string };
}
```

## How it works

1. **Bind the input.** `input user: ApiUser from "./user-types"` extracts the type through the TypeScript compiler API (inline structural declarations work too).
2. **Check the mapping.** Every path is validated against the input type. Optional segments require `?.` or a `??` default — and a default _removes_ the optionality from the output type.
3. **Infer the output.** `typeflow types` emits a `user.d.typeflow.ts` declaration, so `import mapUser from "./user.typeflow"` is fully typed (via TypeScript's `allowArbitraryExtensions`).
4. **Run it anywhere.** Compiled mappings are JSON-serializable and executed by a small, deterministic, dependency-free interpreter — Node, Bun, browsers, CI.

## Quick start

```console
$ bun add -d @thomasfarineau/typeflow
$ bunx typeflow init                 # scaffold an example mapping
$ bunx typeflow check                # tsc-style diagnostics
$ bunx typeflow infer user.typeflow  # print the inferred output type
$ bunx typeflow types                # generate .d.typeflow.ts declarations
$ bunx typeflow run user.typeflow --input data.json
$ bunx typeflow watch                # re-check + regenerate on change
```

Enable typed imports in `tsconfig.json`:

```jsonc
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

### Programmatic API

```ts
import { loadTypeflowMapping } from '@thomasfarineau/typeflow';

const mapUser = await loadTypeflowMapping('./user.typeflow');
const view = mapUser(apiResponse);
```

## The language (v0.1)

| Feature            | Example                                                           |
| ------------------ | ----------------------------------------------------------------- |
| Path access        | `user.address.city`                                               |
| Optional access    | `user.contact?.email` (required when the path is optional)        |
| Defaults           | `country ?? "unknown"` (removes optionality from the output type) |
| Computed fields    | `user.firstName + " " + user.lastName`                            |
| Conditionals       | `user.n > 10 ? "big" : "small"`                                   |
| Array filtering    | `user.labels[active]` (predicate in element scope)                |
| Array indexing     | `user.labels[0]` (typed as `element \| undefined`)                |
| Array path mapping | `user.labels.name` → `string[]`                                   |
| Projection         | `user.items -> { label: upper(name) }`                            |
| Functions          | `upper`, `lower`, `trim`, `count`, `sum`, `join`                  |
| Comparisons        | `==` `!=` `<` `<=` `>` `>=` (no-overlap comparisons are flagged)  |

Deliberately **not** a programming language: no loops, no mutation, no recursion, no I/O, no inline lambdas. Mappings are deterministic and sandboxable by construction.

## Why not …?

|                                     | Typeflow | JSONata | jq  | Zod             | Plain TS function |
| ----------------------------------- | -------- | ------- | --- | --------------- | ----------------- |
| Declarative transformation          | ✅       | ✅      | ✅  | ❌ (validation) | ❌                |
| Input paths statically validated    | ✅       | ❌      | ❌  | n/a             | ✅                |
| Output type inferred                | ✅       | ❌      | ❌  | ⚠️ declared     | ✅                |
| Serializable / sandboxable artifact | ✅       | ✅      | ✅  | ❌              | ❌                |
| Deterministic by design             | ✅       | ⚠️      | ✅  | n/a             | ❌                |

Zod is a natural _input_ to Typeflow, not a competitor: Zod answers "is this X?"; Typeflow answers "how does X become Y, and is that conversion sound?"

## Monorepo layout

| Package                                       | Responsibility                                                |
| --------------------------------------------- | ------------------------------------------------------------- |
| `@thomasfarineau/typeflow`                    | Umbrella: compiler + runtime + adapters, one install          |
| `@thomasfarineau/typeflow-core`               | Type model, AST/IR, diagnostics. Zero dependencies            |
| `@thomasfarineau/typeflow-parser`             | Lexer + recursive-descent parser                              |
| `@thomasfarineau/typeflow-compiler`           | Binding, semantic analysis, type inference, `.d.ts` emission  |
| `@thomasfarineau/typeflow-runtime`            | Deterministic IR interpreter. Zero dependencies, browser-safe |
| `@thomasfarineau/typeflow-adapter-typescript` | `input x: T from "./mod"` via the TS compiler API             |
| `@thomasfarineau/typeflow-cli`                | `check` / `infer` / `types` / `run` / `watch` / `init`        |

## Development

```console
$ bun install
$ bun test            # 38 tests across parser, compiler, runtime, adapter, e2e
$ bun run typecheck   # generate example declarations + tsc --noEmit
$ bun run demo        # compile + run examples/api-response
$ bun run docs:dev    # docs + playground (VitePress)
```

## Roadmap

- **v0.1 (this)** — core language, TS adapter, inference, `.d.typeflow.ts` emission, CLI.
- **v0.5** — language server + VS Code extension, Zod/JSON Schema adapters, fragments, `match` on discriminated unions, fixtures, formatter, contract mode (declared output).
- **v1.0** — frozen grammar + conformance suite, OpenAPI adapter, execution limits, Vite plugin, docs site with playground.

Pre-1.0, syntax and APIs are **unstable** by design.

## License

MIT © Thomas Farineau
