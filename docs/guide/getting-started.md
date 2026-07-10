# Getting started

[[toc]]

Typeflow lets you write JSON transformations in `.typeflow` files that TypeScript actually understands — input paths are validated, output types are inferred, and mistakes fail your build instead of your production traffic.

## Install

One package, no extra setup — works with plain Node (≥ 18), npm, pnpm, or Bun:

```console
$ npm i typeflow-js
```

::: warning Pre-release
Typeflow is pre-1.0: syntax and APIs are unstable by design, and the package is not yet published to npm. Clone the repository to try it today.
:::

## Your first mapping

Scaffold an example:

```console
$ npx typeflow init
Created user-types.ts, user.typeflow.
```

`user.typeflow` binds its input to an exported TypeScript type and mirrors the output shape:

```
input user: User from "./user-types"

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
}
```

Check it, inspect the inferred output, run it:

```console
$ npx typeflow check user.typeflow
✔ 1 mapping(s) checked, 0 errors.

$ npx typeflow infer user.typeflow
{ id: number; fullName: string; email: string; activeTags: string[] }

$ echo '{"id":1,"firstName":"Ada","lastName":"Lovelace","labels":[]}' | npx typeflow run user.typeflow
```

## Use it from code

`loadTypeflowMapping` compiles the file, resolves its TypeScript types, imports any
[`use` functions](/functions/custom#use), and returns a ready mapping function:

```ts
import { loadTypeflowMapping } from 'typeflow-js';

const mapUser = await loadTypeflowMapping('./user.typeflow');
const view = mapUser(apiResponse);
```

For hot paths, compile once and serialize: the compiled artifact is plain JSON, and
`typeflow-js/runtime` is a tiny dependency-free interpreter you can ship alone
(it even runs in the browser — the [playground](/playground) is exactly that).

```ts
import { compile } from 'typeflow-js';
import { createMapping } from 'typeflow-js/runtime';

const { compiled } = compile(source, { fileName: 'user.typeflow' });
const mapUser = createMapping(compiled!);
```

## Typed imports

Generate declarations and enable `allowArbitraryExtensions`:

```console
$ npx typeflow types
generated user.d.typeflow.ts
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

TypeScript now understands `import mapUser from "./user.typeflow"` — with full input/output types.

## CI

```console
$ typeflow check && typeflow types --check
```

`types --check` fails if committed declarations have drifted from the mappings.
