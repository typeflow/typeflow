# Getting started

Typeflow lets you write JSON transformations in `.typeflow` files that TypeScript actually understands — input paths are validated, output types are inferred, and mistakes fail your build instead of your production traffic.

## Install

```console
$ bun add -d @thomasfarineau/typeflow
```

::: warning Pre-release
Typeflow is pre-1.0: syntax and APIs are unstable by design, and the packages are not yet published to npm. Clone the repository to try it today.
:::

## Your first mapping

Scaffold an example:

```console
$ bunx typeflow init
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
$ bunx typeflow check user.typeflow
✔ 1 mapping(s) checked, 0 errors.

$ bunx typeflow infer user.typeflow
{ id: number; fullName: string; email: string; activeTags: string[] }

$ echo '{"id":1,"firstName":"Ada","lastName":"Lovelace","labels":[]}' | bunx typeflow run user.typeflow
```

## Typed imports

Generate declarations and enable `allowArbitraryExtensions`:

```console
$ bunx typeflow types
generated user.d.typeflow.ts
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

With the Bun plugin preloaded, `.typeflow` files import as typed functions:

```toml
# bunfig.toml
preload = ["./typeflow-preload.ts"]
```

```ts
// typeflow-preload.ts
import { plugin } from "bun";
import { typeflowPlugin } from "@thomasfarineau/typeflow-bun-plugin";
plugin(typeflowPlugin());
```

```ts
import mapUser from "./user.typeflow"; // (input: Input) => Output
```

## Programmatic API

```ts
import { loadTypeflowMapping } from "@thomasfarineau/typeflow";

const mapUser = await loadTypeflowMapping("./user.typeflow");
const view = mapUser(apiResponse);
```

## CI

```console
$ typeflow check && typeflow types --check
```

`types --check` fails if committed declarations have drifted from the mappings.
