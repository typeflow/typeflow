# typeflow-idea-plugin

JetBrains IDE plugin (IntelliJ IDEA, WebStorm, any IDE on the IntelliJ
Platform) for `.typeflow` mapping files. Not published — a starting point
(`jetbrains-plugin/`, sibling to `./rust`'s convention for spikes outside the
main npm package).

## What it does

- **Syntax highlighting** — `TypeflowFileType`/`TypeflowLanguage` +
  `TypeflowLexer` (hand-rolled port of `src/parser/lexer.ts`'s tokenizer:
  keywords, identifiers, numbers, strings, `#`/`//` comments, operators vs
  structural punctuation) + `TypeflowSyntaxHighlighter`. Colors customizable
  via Settings → Editor → Color Scheme → Typeflow (`TypeflowColorSettingsPage`).
- **Inline diagnostics ("watch")** — `TypeflowExternalAnnotator` runs
  `typeflow check --json <file>` (see `src/cli/commands/analyze.ts`'s
  `--json` flag, added alongside this plugin) and turns each diagnostic's
  `span.start`/`span.end` directly into a `TextRange` annotation — no
  line/col conversion needed, the CLI already emits character offsets.
  IntelliJ's own highlighting daemon re-invokes this on edits/saves in the
  background — the platform-idiomatic equivalent of `typeflow watch`, no
  persistent process to manage.

Requires the `typeflow` CLI resolvable from the project (local
`node_modules/.bin`, global install, or a `typeflow` shim on PATH) — this
plugin doesn't bundle Node/Bun or reimplement the checker; it shells out to
the real one, same principle as the removed TS plugin/node-loader work in
`../explore/typescript-plugin.md`.

## Build / try it

```console
$ ./gradlew build       # verified green: compiles, packages, 17/17 tasks
$ ./gradlew buildPlugin # produces build/distributions/typeflow-idea-plugin-0.1.0.zip
$ ./gradlew runIde      # launches a sandboxed IDE instance with the plugin installed
```

Builds clean with the **system default JDK** — no special `JAVA_HOME` setup
needed (see "Build issues found and fixed" below for why that matters).

## Build issues found and fixed while setting this up

Two real toolchain bugs surfaced building this for the first time — neither
is a Typeflow code issue, both are fixed in the committed config:

1. **Kotlin 2.0.21 crashes under JDK 25**: `JavaVersion.parse` (a vendored
   copy of an IntelliJ Platform utility inside the Kotlin compiler) throws
   `IllegalArgumentException: 25.0.1` — it doesn't recognize that version
   string. Fixed by bumping to **Kotlin 2.1.20** in `build.gradle.kts`,
   which parses modern JDK version strings correctly; no `JAVA_HOME`
   override or pinned local JDK needed.
2. **K2 compiler internal crash on `TypeflowExternalAnnotator`**: with
   2.0.21, analyzing the class overriding `ExternalAnnotator<PsiFile, List<TypeflowDiagnostic>>`
   threw `FileAnalysisException: ... IllegalArgumentException: source must
not be null` — a known class of early-K2 bugs analyzing overrides against
   Java-interop platform generics. Also resolved by the 2.1.20 bump.

Both confirmed by a real `./gradlew build` in this environment (not just
read from documentation): failed reproducibly on 2.0.21 with the system JDK,
failed identically even after forcing a local JDK 21, succeeded on 2.1.20
with either JDK.

## Known limitations / not yet validated

- **Not opened in a real IDE session** — `./gradlew build`/`buildPlugin`
  confirm it compiles and packages correctly (real, verified here), but
  whether colors actually render as expected and annotations appear at the
  right spots needs `./gradlew runIde` in an interactive session — not
  something this environment can drive. That's the next step, not a
  theoretical one: everything up to launching the sandboxed IDE is done.
- **`verifyPlugin` not configured** — the IntelliJ Plugin Verifier task
  needs `intellijPlatform.pluginVerification.ides { recommended() }` (and
  downloads a full IDE build to check against); left out to avoid another
  large download for a first pass. `buildPlugin`'s successful packaging is
  the validation done so far.
- **Lexer is best-effort, not the grammar's source of truth** — mirrors
  `lexer.ts`'s token boundaries closely enough for coloring, but doesn't
  replicate its tolerant-mode error recovery. Fine for highlighting; not a
  substitute for the real parser if this ever needs more (folding, brace
  matching, PSI-based navigation).
- **No caching/debounce on the external annotator** — every re-check spawns
  a fresh `typeflow` process. IntelliJ's daemon already throttles reasonably,
  but for very large projects this may need tuning (e.g. persistent process,
  or debounce) if it turns out to be slow.
- **`typeflow` must be resolvable on PATH** as literally `typeflow` — no
  fallback to `npx typeflow`/`bunx typeflow`/a project-relative
  `node_modules/.bin/typeflow` lookup yet. Easy follow-up if needed.
