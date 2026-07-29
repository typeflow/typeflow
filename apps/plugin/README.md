# @typeflowjs/plugin

Import `.typeflow` mapping files directly, in every JS/TS environment:

```ts
import mapUser from './user.typeflow'; // TS or JS, Node ESM, Bun, Vite
const mapUser = require('./user.typeflow'); // Node CommonJS

const view = mapUser(apiResponse);
```

The module's default export is the compiled mapping function. Types come from
the `.d.typeflow.ts` sidecars (`typeflow types` + `allowArbitraryExtensions`
in tsconfig), so the import is fully typed — this package supplies the
runtime half.

## Setup

| Environment                       | Setup                                                            |
| --------------------------------- | ---------------------------------------------------------------- |
| TypeScript via `tsc` (tsconfig)   | sidecars for types; run the emitted JS with the Node flag below  |
| Node — JS/emitted ESM **and** CJS | `node --import @typeflowjs/plugin/register app.js`                 |
| tsx                               | `tsx --import @typeflowjs/plugin/register app.ts`                  |
| ts-node (CommonJS mode)           | `node -r ts-node/register --import @typeflowjs/plugin/register app.ts` |
| Bun — TS or JS                    | `preload = ["@typeflowjs/plugin/bun"]` in bunfig.toml              |
| Vite (dev, build, SSR) / Rollup   | `plugins: [typeflow()]` from `@typeflowjs/plugin/vite`             |

The Node hooks chain: tsx/ts-node handle `.ts`, this plugin handles
`.typeflow`, in the same process and in either flag order.

**Node** (one flag covers both ESM `import` and CJS `require`):

```console
$ node --import @typeflowjs/plugin/register app.js
```

or programmatically, before the first `.typeflow` import:

```ts
import { register } from '@typeflowjs/plugin';
register();
```

**Bun** (`bun run`, `bun test`, `bun build`) — in `bunfig.toml`:

```toml
preload = ["@typeflowjs/plugin/bun"]
```

**Vite / Rollup** — in `vite.config.ts`:

```ts
import typeflow from '@typeflowjs/plugin/vite';

export default defineConfig({ plugins: [typeflow()] });
```

Compilation happens at build/dev time and the emitted module only pulls the
browser-safe `typeflowjs/runtime`, so this works for browser apps too — the
compiler never ships to the client.

Runnable examples for every environment live in [`examples/`](./examples/).

## How it works

All three hooks share one core (`src/compile.ts`): the file is compiled once
in the hook (TypeScript adapter included, so `input x: T from "./types"`
works), and the emitted module embeds the compiled JSON artifact — at
runtime the consumer's module graph only loads `typeflowjs/runtime` (the
tiny dependency-free interpreter) plus the mapping's own `use` modules,
never the compiler.

- `./register` → Node `module.register()` ESM hooks + a `require.extensions`
  hook for CJS.
- `./bun` → `Bun.plugin` (runtime and bundler).
- `./vite` → Vite/Rollup plugin (same object shape works for both).
- `use fn(...) from "./mod"` declarations become real imports of the emitted
  module — resolved to extension-explicit relative paths, so they work under
  Node ESM (no extension guessing), Vite, and Bun alike. Under `require()`,
  ESM `use` modules need Node >= 22.12.
- Functions registered programmatically via `defineFunction` can't be wired
  through a bare file import — use `loadTypeflowMapping` from `typeflowjs`
  for those.

## Build & test

```sh
bun install
bun run typecheck
bun run test   # builds, then verifies the full matrix against real
               # toolchains: node esm/cjs, bun js/ts, tsc esm/cjs (typed,
               # real tsconfig), vite build — needs the repo root's
               # `bun scripts/build.ts` first
```

Like the other `apps/*` packages, `typeflowjs` is deliberately not a
declared dependency here (see `scripts/link-local-deps.ts` at the repo root);
consumers get it as a peer at publish time.
