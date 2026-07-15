# @typeflow/plugin examples

One self-contained example per supported environment. Each uses the real
published specifiers (`@typeflow/plugin/...`), which resolve inside this
monorepo through the postinstall symlinks (`scripts/link-local-deps.ts` at
the repo root).

| Example       | Shows                                                              |
| ------------- | ------------------------------------------------------------------ |
| `node-esm/`   | `import mapUser from './user.typeflow'` in plain-JS ESM under Node |
| `node-cjs/`   | `require('./user.typeflow')` in CommonJS under Node                |
| `typescript/` | tsc with a real tsconfig — typed import via the sidecar, then run  |
| `bun/`        | TypeScript under Bun, wired through `bunfig.toml`                  |
| `tsx/`        | TypeScript run with tsx — its hooks and the plugin's chain         |
| `ts-node/`    | ts-node's CommonJS mode (`-r ts-node/register`)                    |
| `vite/`       | Browser app: the mapping runs client-side, compiled at build time  |

## Prerequisites (once, from the repo root)

```sh
bun install            # creates the node_modules symlinks
bun scripts/build.ts   # typeflow-js dist (the generated modules import typeflow-js/runtime)
bun run --cwd apps/plugin build
```

Then run any example from this directory (or follow each one's README):

```sh
bun run node-esm
bun run node-cjs
bun run typescript   # sidecar + tsc + node (typed end to end)
bun run bun-ts
bun run tsx
bun run ts-node
bun run vite-build   # or vite-dev for the dev server
bun run all          # everything except vite-dev
```

(tsx and ts-node resolve from apps/plugin's devDependencies here; in a real
project install them yourself.)
