# @typeflow/cli

The Typeflow command-line tool: check mappings and report diagnostics,
generate `.d.typeflow.ts` declarations, run/watch mappings, format `.typeflow`
sources, and convert jq/JSONata expressions to Typeflow.

Lives in `apps/` alongside the main `typeflowjs` package and
`@typeflow/converters`, which it consumes lazily where needed (see
`src/commands/convert.ts`). It is deliberately **not** a declared Bun
workspace member — see `scripts/link-local-deps.ts` at the repo root for why
(a Bun bug prevents `workspace:*` resolving to the repo root once it's a
transitive dependency here) — so local dev relies on that repo-root
postinstall symlink hack rather than real npm dependency entries.

## Build

```sh
bun run build      # bundles src/main.ts → dist/main.js (ESM node bin)
bun run typecheck
```

## Extracting into its own repo

This package is meant to move to `github.com/typeflowx/cli` once that org
exists. Until then, development stays in this monorepo — `npm publish` for
this package runs from here via `.github/workflows/cli-release.yml`, tag
`cli-vX.Y.Z`. When it's time to give it a standalone public repo, mirror its
history out with `git subtree` rather than a hard move — that keeps this
monorepo's dev workflow (single PR flow, shared CI, the symlink hack above)
intact:

```sh
git subtree split --prefix=apps/cli -b cli-split
git push <cli-repo-remote> cli-split:main
```

Once actually split out, `typeflowjs` and `@typeflow/converters` should
become real `dependencies` in `package.json` (both are npm-published by
then) — the symlink hack above is monorepo-local plumbing and becomes moot
for a standalone checkout.
