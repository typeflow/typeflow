# TypeScript plugin for `.typeflow` — analysis

_Report from 2026-07-05. Scope B implemented the same day — see
"Implementation" at the very bottom._

## Goal

`import userTypeflow from "./user.typeflow"` with full inference in the
IDE (hover, autocomplete on the output, errors on bad fields) —
"naturally", with no manual step to remember.

## What already exists (and already works)

The mechanism doesn't need to be invented, it's already in the repo:

- `tsconfig.json` has `allowArbitraryExtensions: true`.
- `emitDts()` (`src/compiler/emit.ts`) generates a `.d.typeflow.ts` sidecar
  next to the `.typeflow` file:
  ```ts
  type TypeflowInput = { id: number; firstName: string; ... };
  type TypeflowOutput = { id: number; fullName: string; ... };
  declare const mapping: (input: TypeflowInput) => TypeflowOutput;
  export default mapping;
  ```
  Thanks to `allowArbitraryExtensions`, TypeScript resolves
  `import mapUser from "./user.typeflow"` against this `user.d.typeflow.ts` —
  this is a standard TS 5.0+ feature, not a hack.
- `typeflow types` (`src/cli/commands/analyze.ts:cmdTypes`) generates these
  sidecars in one pass; `typeflow types --check` detects drift (useful in
  CI, already wired into the `typecheck` script in `package.json`).
- `typeflow watch` (`cmdWatch`) watches the filesystem (`fs.watch`,
  150 ms debounce) and regenerates the `.d.typeflow.ts` files on every save
  of a `.typeflow` file. Run alongside the editor, this already gives a
  near-"live" experience: VS Code/tsserver detect the `.d.typeflow.ts` file
  changed on disk and refresh inference with no further action.

So `import x from "./user.typeflow"` **works and infers correctly today**,
as long as `typeflow watch` has been launched (or `typeflow types` re-run
after each edit).

## What's missing for it to be "natural"

Three frictions, independent of each other:

1. **You have to remember to launch `typeflow watch`.** Nothing does it
   automatically when the project opens — it's neither automatic nor
   discoverable for someone who doesn't read the README.
2. **File latency.** Save → `fs.watch` (150 ms debounce) → recompile →
   disk write → tsserver picks up the file. In practice near-instant, but
   it's not the keystroke-by-keystroke experience a real language plugin
   gives (editing in an unsaved buffer, for instance).
3. **Nothing inside the `.typeflow` file itself.** This whole chain only
   concerns the `.ts` file that _imports_ the mapping. Opening
   `user.typeflow` in the editor gives no syntax highlighting, no inline
   errors (TF2xxx), no autocomplete on the input fields or the 51
   builtins — only `typeflow check`/`watch` in the terminal shows those.

These are three different problems with three different solutions. A
"TypeScript plugin" only addresses the first and the second.

## What a real TypeScript plugin (Language Service Plugin) would bring

TypeScript exposes a plugin API (`ts.server.PluginModule`, loaded by
`tsserver` — the process that VS Code, WebStorm, and Neovim/coc-tsserver
all drive). It's the mechanism behind `@vue/typescript-plugin` (`.vue`),
`svelte-language-server`, and the Astro extension: making `tsserver`
understand a file that isn't TypeScript, so the IDE (hover, autocomplete,
diagnostics, go-to-definition) works as if it were.

Two possible building blocks, which can be combined:

### A. Language Service proxy

The plugin receives the real `LanguageService` and returns an object that
intercepts certain methods (`getSemanticDiagnostics`,
`getQuickInfoAtPosition`, `getCompletionsAtPosition`…) for positions that
fall on a `.typeflow` import or its specifier.

### B. Virtual files via `resolveModuleNameLiterals` + `getScriptSnapshot`

The plugin intercepts module resolution: when `tsserver` encounters
`import x from "./user.typeflow"`, instead of looking for
`user.d.typeflow.ts` on disk, the plugin **synthesizes an in-memory
file** — the same content `emitDts()` already produces, computed on the
fly by calling `compile()` on the CURRENT content of the buffer (not
necessarily saved). This eliminates friction #2: no more need to write to
disk, tsserver already has the whole file-version invalidation mechanism
(`getScriptVersion`) to refresh only what changed.

This is a direct reuse of what already exists: `compile()` and
`emitDts()` are already the right API, there's nothing to duplicate on
the type-logic side — the plugin is just an adapter between the
`ts.LanguageServiceHost` API and what already exists in `src/compiler`.

### Important constraint: `tsc` on the CLI ignores language plugins

`tsc --noEmit` (used by `bun run typecheck` and by CI) **does not load**
`tsserver` plugins — only editors do. This is exactly why the Vue
ecosystem had to create `vue-tsc` (a separate CLI wrapper) on top of
`@vue/typescript-plugin`: the plugin alone isn't enough for the command
line.

Good news: typeflow doesn't have this problem to solve, it's already
handled — `typeflow types --check` does exactly the CLI verification work
that `vue-tsc` does for Vue, and already exists. A TS plugin wouldn't
change anything here; the two mechanisms would coexist (plugin for the
IDE, `types --check` for CI), with no logic duplication since both call
`compile()`/`emitDts()`.

### Adoption constraint

A Language Service Plugin **is not zero-config**: the consuming project
must add to its `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@thomasfarineau/typeflow/ts-plugin" }],
  },
}
```

No worse than Vue/Svelte/Astro (all of which require this), but it's
still one extra manual step on top of `npm i` — to weigh against the
actual gain (eliminating the background `typeflow watch` task).

## Three possible scopes

### A. Automate what exists (small, no TS plugin)

`typeflow watch` already exists but is never launched automatically.
Options without writing a TS plugin:

- Document/ship a `.vscode/tasks.json` with `"runOn": "folderOpen"`
  launching `typeflow watch` when the folder opens in VS Code.
- A `postinstall` hook that reminds the user to launch it (or launches it
  in the background via a lightweight supervisor) — more intrusive,
  avoid by default.

Closes friction #1 for VS Code specifically, zero new code in `src/`, one
config file. Doesn't solve file latency nor the editing experience of the
`.typeflow` file itself.

### B. Real Language Service Plugin (medium)

Subpath of the existing package `@thomasfarineau/typeflow/ts-plugin` (not
a new separate package — consistent with a single `npm i`):

- Implements `resolveModuleNameLiterals` + virtual files (option B above)
  for `.typeflow` imports, reusing `compile()` + `emitDts()` as-is.
- Eliminates file latency and the need to launch `typeflow watch` for the
  IMPORT to be inferred — but only in the editor (see CI constraint
  above, already covered by what exists).
- Brings nothing to editing the `.typeflow` file itself (scope C).

#### Validation: the core mechanism works, tested directly against the TS API

The main technical risk of B — does redirecting an import to a virtual
file computed on the fly really give live hover/autocomplete? — can be
tested without writing a real `tsserver` plugin: a custom
`ts.LanguageServiceHost` is enough, called directly via
`ts.createLanguageService`. Tested with the real `compile()`/`emitDts()`
from `src/compiler`, no type logic reimplemented.

```ts
const host: ts.LanguageServiceHost = {
  // ...
  getScriptSnapshot: (fileName) => {
    if (fileName === DTS_FILE) {
      // The core of the mechanism: (re)computed on the fly from the
      // mapping's IN-MEMORY source, never written to disk.
      return ts.ScriptSnapshot.fromString(currentDts());
    }
    // ...
  },
  resolveModuleNameLiterals: (literals) =>
    literals.map((lit) =>
      lit.text.endsWith('.typeflow')
        ? { resolvedModule: { resolvedFileName: DTS_FILE, extension: ts.Extension.Dts, isExternalLibraryImport: false } }
        : /* normal resolution */,
    ),
};
```

Result, on `import mapUser from "./user.typeflow"` + `const out = mapUser(...); out.`:

```
=== hover on mapUser ===
(alias) mapUser(input: TypeflowInput): TypeflowOutput

=== completions on `out.` (initial mapping) ===
[ "fullName", "id", "isAdmin" ]

=== completions on `out.` (after IN-MEMORY edit, +email field) ===
[ "email", "fullName", "id", "isAdmin" ]
```

The last line is the point that matters: the mapping was modified in
memory (no disk save, no file rewrite), only a version counter was
incremented — `getCompletionsAtPosition` reflects the new field
immediately. This is exactly the promise of scope B (zero latency, no
`typeflow watch`), demonstrated without writing the full `tsserver`
plugin.

What this doesn't yet test: behavior **inside a real `tsserver`** driven
by an editor (the `ts.server.PluginModule` is an extra layer — an object
`{ create(info): ts.LanguageService }` that `tsserver` instantiates per
project, where `info.languageServiceHost` is already provided by
`tsserver` itself: existing methods on that host must then be _patched_
rather than providing a fresh one from scratch as above). This is a
scaffolding change, not a mechanism change — the part proven here
(redirection + recomputed snapshot + version-based invalidation) is
reused as-is inside `create()`.

- Revised effort: the risk of "does module redirection really give live
  updates" is resolved. What remains: the `ts.server.PluginModule`
  scaffolding (creating/patching the host provided by `tsserver`,
  handling multiple projects), surfacing TF2xxx diagnostics from the
  mapping itself on the import line (mapping typeflow spans → TS ranges),
  and packaging/publishing. ~1 week remains a reasonable estimate;
  reference: source code of the Vue/Svelte/Astro plugins for the
  `PluginModule` scaffolding.

### C. `.typeflow` editing experience (bigger, out of scope of the original request)

Syntax highlighting, inline errors (TF2xxx), hover and autocomplete on
input fields and the 51 builtins **inside** the `.typeflow` file — a real
but different need, which a TS Language Service Plugin can't solve (the
`.typeflow` file isn't TypeScript, tsserver never opens it). Two options
if this ever becomes a priority:

- A dedicated VS Code extension (TextMate grammar + a diagnostic
  collection fed by `compile()`) — fastest, but VS Code only.
- A real LSP server (`vscode-languageserver`) — portable (VS Code,
  Neovim, JetBrains via LSP4IJ), more work, still reuses
  `compile()`/`checker` on the semantic side.

Scope independent of A and B; only tackle if the need arises (today
`typeflow check`/`watch` in the terminal covers the signal, just not
inline).

## Recommendation

1. **Short term**: scope A — a documented `.vscode/tasks.json` (or
   bundled into `typeflow init`) that automatically launches
   `typeflow watch`. Zero new package, closes the dumbest friction ("I
   forgot to launch watch") for most VS Code users.
2. **If the need for zero latency is confirmed**: scope B — the core
   mechanism (module redirection + recomputed snapshot + version-based
   invalidation) is validated, not just theoretical (see above). What
   remains is known `ts.server.PluginModule` scaffolding (Vue/Svelte/Astro
   precedents), not research. Just an adapter around
   `compile()`/`emitDts()`, no duplicated type logic. Keep
   `typeflow types --check` for CI (already done, unchanged).
3. **Scope C** (editing the `.typeflow` file itself): separate backlog,
   not a prerequisite for the import to be "naturally inferred" — that's
   already true today for the importing file, via the existing
   mechanism.

## Implementation (scope B)

Done, in `src/ts-plugin/index.ts`, exported as a subpath of the package
(`@thomasfarineau/typeflow/ts-plugin`) — not a new separate npm package,
consistent with the "single `npm i`" principle.

### What the code does

`init({ typescript }) → { create(info), getExternalFiles(project) }` —
the standard shape of a `ts.server.PluginModule`:

- `create(info)` patches in place the methods of
  `info.languageServiceHost` already built by `tsserver`:
  - `resolveModuleNameLiterals`: any specifier ending in `.typeflow` is
    redirected to a virtual file `<path>.typeflow.d.ts` (path resolved by
    hand, normalized to `/` — see bug below); everything else passes
    through to the original resolution.
  - `getScriptSnapshot` / `getScriptVersion` / `fileExists` / `readFile`:
    for a `*.typeflow.d.ts` path, call `computeDts()`, which reads the
    real `.typeflow` file via `ts.sys.readFile`, calls `compile()` +
    `emitDts()` (the same functions `typeflow types` uses), and caches by
    mtime — no recompilation if the file hasn't changed.
  - `getExternalFiles(project)`: lists the real `.typeflow` files
    matching the already-resolved virtual files, so the editor watches
    them and revalidates importers — a bonus, not a prerequisite (the
    version check at request time is already enough).
- `input user: T from "./mod"` works: `computeDts` passes
  `createTypeScriptResolver()` (the same adapter as the CLI) to
  `compile()`, not just inline types.

### Bug found and fixed during validation

First attempt: the virtual path was built by concatenating a
`.typeflow.d.ts` suffix onto a path that already ended in `.typeflow` →
`user.typeflow.typeflow.d.ts`, resolution silently failed (no error, just
`unknown` everywhere). Second bug, Windows-specific: `path.resolve`/
`path.dirname` return backslash paths, while TS's internal file keys are
canonically `/`-based even on Windows — without normalization, the
virtual file existed under a key `getScriptSnapshot` never recognized.
Both fixed, tested before and after (see below).

### Validation

Two levels, both against real code, not against a reimplementation:

1. **Mechanism** (before writing `src/ts-plugin/`): a hand-built
   `ts.LanguageServiceHost` with the redirection directly inside it,
   tested via `ts.createLanguageService`. Used to validate the idea
   before investing in the `PluginModule` scaffolding.
2. **Real artifact** (after): `dist/ts-plugin/index.cjs` (the project's
   normal `bun run build` output) loaded via `require()` — exactly as
   `tsserver` would — then `create(info)` called on a `LanguageService`
   **already built** before the patch (this reproduces the real order:
   `tsserver` builds its `Project`/`LanguageService` then instantiates
   plugins afterward). Result, on the example `user.typeflow` mapping:

   ```
   hover on mapUser → (alias) mapUser(input: TypeflowInput): TypeflowOutput
   diagnostics → []
   completions on `out.` → [ "fullName", "id" ]

   # user.typeflow modified ON DISK (+ isAdmin field), without restarting anything:
   completions on `out.` → [ "fullName", "id", "isAdmin" ]
   ```

`bun run build && bun test && bunx tsc --noEmit -p tsconfig.json` all
pass (148 tests, 0 failures).

### What is NOT validated

Behavior inside a real `tsserver` driven by VS Code/an editor — tested
here via a harness that reproduces the real API and call order
(`LanguageService` built before the patch), but not via a real editor
session. To do before documenting the feature as stable: add
`"plugins": [{ "name": "@thomasfarineau/typeflow/ts-plugin" }]` to a
consuming project's `tsconfig.json` and open `consumer.ts` in VS Code to
confirm hover/autocomplete under real conditions.

Also confirmed in this report, not just assumed: without a companion
editor extension, "live" means "up to date with the last file saved to
disk" (the test above edits the file with `writeFileSync`, not an
unsaved buffer) — the plugin eliminates `typeflow watch` and the
`.d.typeflow.ts` file, not the save step itself.

## Real example built (`examples/ts-plugin/`, since removed)

A standalone Node example was added and validated, with no
`package.json`/`node_modules` (self-referencing, like
`examples/api-response` and `examples/bun-plugin`):

- `hover-demo.ts` — local `import mapUser from "./user.typeflow"`,
  designed to be opened in an editor (hover, autocomplete, update after
  save).
- `cross-import-demo.ts` — `import mapUser, { type Input } from
  "../api-response/user.typeflow"`: a **cross-directory** import of a
  mapping from another example, which declares an external type
  (`ApiUser from "./user-types"`, not inline). Validated that the plugin
  resolves the external type via `createTypeScriptResolver()` relative
  to the `.typeflow` file's directory, regardless of who imports it:
  ```
  hover on mapUser → (alias) mapUser(input: Input): TypeflowOutput
  hover on Input   → type Input = { id: number; firstName: string; ...; address: {...}; scores: number[] }
  completions on mapped. → [ activeTags, address, email, fullName, id, isAdmin, tagCount, totalScore ]
  ```
- `run.ts` — actually runs the mapping (explicit `compile()` +
  `createMapping()`), without depending on either mechanism below.

## Second mechanism built: running `.typeflow` outside Bun (`src/node-loader/`)

Follow-up question raised along the way: the TS plugin makes the import
*typed*, but `hover-demo.ts`/`cross-import-demo.ts` are only runnable
with the Bun plugin (`@thomasfarineau/typeflow/plugin`, preloaded via
`bunfig.toml`) — plain `tsx`/`ts-node`/`node` fail with
`ERR_UNKNOWN_FILE_EXTENSION` (no loader for `.typeflow`).

Answer: a native Node loader hook (`node:module` `register()` — the
mechanism `tsx` itself is built on, visible in its own stack trace:
`node:internal/modules/customization_hooks`). Same codegen as the Bun
plugin (compile once, emit a small `createMapping(<JSON artifact>)`
module), exposed as a subpath `@thomasfarineau/typeflow/node-loader`.

Actually validated, not just in theory:

```console
$ node --import ./register.mjs --experimental-strip-types hover-demo.ts
42 Ada Lovelace true [ 'founder' ]

$ NODE_OPTIONS="--import ./register.mjs" npx tsx cross-import-demo.ts
Ada Lovelace { city: 'London', country: 'unknown' }
```

Resulting complete matrix:

| Need                               | Mechanism                                    |
| ----------------------------------- | --------------------------------------------- |
| IDE inference (hover/autocomplete)  | `@thomasfarineau/typeflow/ts-plugin`          |
| Running under Bun                   | `@thomasfarineau/typeflow/plugin`             |
| Running under Node/tsx/ts-node      | `@thomasfarineau/typeflow/node-loader`        |

## Current state: removed from the code

Both mechanisms built in this session (`src/ts-plugin/`,
`src/node-loader/`), the example (`examples/ts-plugin/`), and the
associated wiring (`package.json` exports, `scripts/build.ts`,
`tsconfig.json` paths, README section) have been **removed from the
code** — nothing was left in place.

The pre-existing Bun plugin (`src/plugin/index.ts`,
`examples/bun-plugin/`, subpath `@thomasfarineau/typeflow/plugin`) was
removed right after, at explicit request — it wasn't an addition from
this session but an already-shipped feature. With all three mechanisms
gone, there is no longer any way to run a `.typeflow` import directly
(`import x from "./m.typeflow"`) in this repo — only explicit
`compile()` + `createMapping()` (or `loadTypeflowMapping()`) remain,
which works everywhere with no plugin at all.

This report (analysis, reference code, bugs found, validation results
above) remains the baseline to pick back up as-is if this work resumes:
the technical risk is resolved on both sides (module redirection for the
TS plugin, `register()` hook for execution), all that's left is code to
rewrite, not research.
</content>
