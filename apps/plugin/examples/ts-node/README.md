# ts-node (CommonJS)

ts-node's classic CJS mode (`-r ts-node/register`) composes with the
plugin's require hook — this dir's own tsconfig/package.json set the
CommonJS context ts-node expects:

Unlike tsx, ts-node typechecks — so the `.typeflow` import needs its
`.d.typeflow.ts` sidecar first:

```sh
bunx typeflow types user.typeflow
node -r ts-node/register --import @typeflowjs/plugin/register app.ts
```

ts-node's ESM loader mode works too (`node --import @typeflowjs/plugin/register
--loader ts-node/esm app.ts`), with ts-node's usual experimental-loader
warning — for ESM TypeScript, prefer the `tsx` example.
