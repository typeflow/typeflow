# TypeScript via tsc (normal tsconfig)

The typed path: `typeflow types` generates the `.d.typeflow.ts` sidecar,
`allowArbitraryExtensions` (see tsconfig.json) makes tsc pick it up — the
`.typeflow` import is statically checked. The emitted JavaScript then runs
under the Node hook.

```sh
bunx typeflow types user.typeflow           # generate the typed sidecar
bun x tsc -p .                              # typecheck + emit app.js
node --import @typeflow/plugin/register app.js
```

Note: the `use` helper here is a `.ts` module, imported as-is by the emitted
code — plain Node loads it via type stripping (Node >= 22.18). For older
Node, compile the helper to `.js`.
