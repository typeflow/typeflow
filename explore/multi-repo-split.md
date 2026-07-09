# Should the repo be split into `core` / `cli` / `converter`?

Date: 2026-07-06
Context: the JetBrains plugin now lives in `jetbrains-plugin/` next to the TS repo. The question raised: is it worth splitting `typeflow` into several npm repos (core, cli, converter)?

## What already exists

The package is **mono-repo, mono-package, zero runtime dependency**:

```json
"dependencies": {},
"devDependencies": { "jsonata": "...", ... }
```

`jsonata` is only used as a devDep, by `src/converter/jsonata` — a sign
that the converter is already thought of as an optional sub-module.

`package.json` already exposes separate **subpath exports**:

- `.` → `src/index.ts`
- `./runtime` → `src/runtime/index.ts`
- `./converter`, `./converter/jsonata`, `./converter/jq` → independent
- `bin.typeflow` → `dist/cli/main.js`

So the *logical* separation (core / runtime / converter / cli) already
exists at the exports level. The question isn't "should the code be
split up" (already done) but "should the git repo / npm package be split
up".

## Actual module sizes

| Module | LOC | Role |
|---|---|---|
| `converter` | 2456 | jq/jsonata → typeflow (the biggest, and the most separable) |
| `compiler` | 1163 | checker + dts emit |
| `builtins` | 1132 | built-in functions |
| `parser` | 914 | lexer/parser |
| `cli` | 595 | commands + reports |
| `core` | 649 | types, ast, diagnostics |
| `runtime` | 398 | interpreter |
| `formatter` | 351 | pretty-printer |
| `adapter` | 198 | TS resolver |

Total ~7850 LOC. This is a **small project**. For comparison, splitting
repos generally makes sense beyond 20-30k LOC per unit, or when
different teams own different parts.

## Actual coupling between modules (via graphify)

Tracing imports:

- `cli` imports `core`, `compiler`, `adapter`, `runtime`, `formatter` —
  **the CLI depends on almost everything**. A separate `cli` repo would
  therefore have to depend on `core` via semver and resync on every
  release, for a module that's only 8% of the LOC.
- `converter` imports `formatter` and imports itself
  (`jq` ← `jsonata/sample-type`). It's the most **independent** module —
  the one that would make the most sense to isolate if there had to be
  one.
- `adapter` imports `core` + `compiler`.
- `compiler`/`builtins`/`runtime`/`core` are heavily interlinked (shared
  types `Type`, `Diagnostic`, `Expr`, `CompiledFn` flow between the four).

The core (`core` + `compiler` + `builtins` + `runtime` + `parser`) forms
a single cohesive block that changes together with every evolution of
the language. Splitting it would break that for zero gain: any PR that
adds a builtin or changes the AST would touch 3 repos.

## Cost of a multi-repo split

Concrete, not theoretical — what it would add:

- **Versioning**: `cli` and `converter` would have to pin a version of
  `core`. Every type change in `core` = bump + republish + bump in the
  other two + republish. For a solo/small-team project, that's pure
  friction, not safety.
- **CI/release**: 3 pipelines, 3 changelogs, 3 `npm publish`,
  coordinating compatible versions.
- **Dev loop**: more `bun link`/workspace juggling to test a `core`
  change in `cli` locally, whereas today it's a simple relative import.
- **The JetBrains plugin doesn't even need this**: it consumes the
  compiled CLI (`dist/cli/main.js`) as an external process, not the TS
  sources. The npm repo split has zero impact on it — the real
  integration surface is the binary/CLI, not npm modularity.

## Expected vs. actual benefits

Classic reasons to split:
1. **Separate teams / ownership** → doesn't apply here (a single
   maintainer).
2. **Different release cycles** → possible in theory (converter changes
   less often than core) but not observed in the commit history, and
   manageable with **subpath exports + version tags** without a repo
   split.
3. **Reduce the bundle consumers pull in** → already solved by the
   separate exports (`./converter`, `./runtime`, etc.), a consumer who
   doesn't import `converter` doesn't even need to tree-shake it — they
   just don't import that path.
4. **Publish `core` alone for other consumers** (e.g. someday a plugin
   that just wants the type-checker without the CLI) → the only argument
   that holds, but already solved by the current subpath exports without
   a separate repo.

## Recommendation

**Don't split into multiple repos now.** The effort/benefit ratio is bad
at this size (7.8k LOC, zero dependencies, a single maintainer), and the
real coupling between `cli`/`core`/`compiler` would make version
synchronization more costly than the value recovered.

If the need reappears later (e.g. someone wants to consume only `core`
as an external dependency, or a dedicated team takes over `converter`),
the cheapest path is a **workspace monorepo** (bun/npm workspaces,
separate packages `@typeflow/core`, `@typeflow/cli`,
`@typeflow/converter` in a single git repo) rather than 3 git repos.
That gives independent versioning and separate publishing without the
cost of cross-repo synchronization — and it can be done while keeping
the current `src/` structure nearly intact (rename folders into
packages, add local `package.json` files).

The only module with a profile autonomous enough to be extracted *alone*
someday is `converter` (2456 LOC, only depends on `formatter`, no
back-and-forth with `core`/`compiler`) — but nothing is urgent.

## Update 2026-07-06: the JetBrains plugin, on the other hand, does leave the repo

Decision made separately (unrelated to the core/cli/converter topic
above): `jetbrains-plugin/` is going to be extracted into its own git
repo, `typeflow-idea-plugin`.

This isn't an exception to the "no split" recommendation — it's a
different case, with an opposite cost/benefit calculation:

- **Zero source coupling.** Verified in `TypeflowCli.kt`: the plugin
  shells out to the `typeflow` binary on the `PATH`
  (`ProcessBuilder("typeflow", "check", ...)`). It depends on none of the
  monorepo's TS sources, only on the CLI once compiled and published.
- **Completely different toolchain**: Gradle/Kotlin/IntelliJ Platform vs
  Bun/TS. No shared tooling, no unified lint/build possible anyway.
- **Independent release cycle, imposed externally**: the JetBrains
  Marketplace has its own versioning, signing (`CERTIFICATE_CHAIN`,
  `PRIVATE_KEY`) and publish pipeline — nothing to do with `npm publish`
  for the TS package.
- **Almost no history to preserve**: only one commit
  (`d2d73cc wip: scaffold JetBrains/IntelliJ plugin`) touches this
  folder. The extraction is a simple copy, not a `git subtree split`.

So: the `core`/`cli`/`converter` split remains discouraged (strong
coupling, same toolchain, same release cycle, zero gain). Extracting
`jetbrains-plugin/` is justified (zero coupling, different toolchain,
externally imposed release cycle). Both decisions use the same
criterion — actual coupling + shared toolchain — they just point in
opposite directions depending on the module.

Extraction plan adopted: new repo `typeflow-idea-plugin`, copy the
useful content (`src/`, `build.gradle.kts`, `settings.gradle.kts`,
`gradle/`, `gradlew*`, `README.md`) excluding build artifacts
(`.gradle/`, `.intellijPlatform/`, `.kotlin/`, `build/`), recreate a
local `.gitignore`, then `git rm -r jetbrains-plugin` in `typeflow` once
the new repo is verified.
</content>
