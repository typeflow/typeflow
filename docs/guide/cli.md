# CLI

[[toc]]

All commands accept glob patterns; the default is `**/*.typeflow` (excluding `node_modules`).

| Command           | Effect                                                   |
| ----------------- | -------------------------------------------------------- |
| [`check`](#check) | full analysis, tsc-style diagnostics — the CI workhorse  |
| [`infer`](#infer) | print one mapping's inferred output type                 |
| [`types`](#types) | emit `.d.typeflow.ts` declarations, or verify them in CI |
| [`run`](#run)     | compile and execute a mapping                            |
| [`watch`](#watch) | re-check and regenerate declarations on file change      |
| [`init`](#init)   | scaffold an example mapping                              |

## `typeflow check [patterns...]` {#check}

Full analysis with tsc-style diagnostics. Exits non-zero on errors — the CI workhorse.

```console
$ typeflow check
user.typeflow:4:11 - error TF2002: Property 'emial' does not exist on type
'{ email: string }'. Did you mean 'email'?
```

## `typeflow infer <file>` {#infer}

Prints the inferred output type of one mapping. The exploratory "what does this produce?" tool.

## `typeflow types [patterns...] [--check]` {#types}

Emits `.d.typeflow.ts` declaration files next to each mapping (TypeScript's `allowArbitraryExtensions` convention). `--check` verifies the committed declarations are current and exits non-zero on drift — the CI drift guard.

## `typeflow run <file> [--input data.json]` {#run}

Compiles and executes a mapping; input comes from `--input` or stdin, output is printed as JSON. Great for debugging and one-off transformations.

## `typeflow watch [patterns...]` {#watch}

Re-checks and regenerates declarations whenever a `.typeflow` or `.ts` file changes. What you leave running while developing.

## `typeflow init` {#init}

Scaffolds an example mapping (`user.typeflow`) and its types module in the current directory.

## CI recipe

```yaml
- run: bun install --frozen-lockfile
- run: bunx typeflow check
- run: bunx typeflow types --check
```
