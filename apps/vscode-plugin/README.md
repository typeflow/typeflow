# Typeflow for VS Code

Language support for `.typeflow` mapping files — the VS Code counterpart of
`apps/jetbrains-plugin`, with the same three features and the same
architecture (no bundled compiler: everything semantic shells out to the
`typeflow` CLI).

## Features

- **Syntax highlighting** — declarative TextMate grammar
  (`syntaxes/typeflow.tmLanguage.json`) mirroring the token classification of
  the docs playground and the JetBrains lexer: keywords, property names,
  function calls, primitive types, literals, `$root`/`$parent`/`$`.
- **Inline diagnostics** — runs `typeflow check --json` on open and save and
  maps the reported character-offset spans to squiggles (TF-codes appear as
  the diagnostic code). Open/save only by design: the CLI reads the file from
  disk, so per-keystroke checks would diagnose stale content.
- **Completion** — declaration keywords and literals as bare words; after a
  `.`, the member chain typed so far (`user.contact.`, `user.labels[0].`) is
  walked through the `input` declaration's resolved type (from the same CLI
  call) to offer actual field names with their types.

## Requirements

The `typeflow` CLI must be resolvable from the workspace (a local
`node_modules/.bin`, a global install, or any PATH shim). Point the
`typeflow.path` setting at a specific binary if needed.

## Build

Requires Bun.

```sh
bun install     # dev types only (@types/vscode, typescript)
bun run build   # bundle src/extension.ts -> dist/extension.js (CJS)
bun run package # build + `vsce package` -> typeflow-<version>.vsix
```

To develop: open this folder in VS Code and press F5 (Run Extension).
