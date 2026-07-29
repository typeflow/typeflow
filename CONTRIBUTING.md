# Contributing

## Development

```console
$ bun install                    # root deps
$ bun test                       # 133 tests across parser, compiler, runtime, adapter, e2e
$ bun run typecheck              # generate example declarations + tsc --noEmit
$ bun run demo                   # compile + run examples/api-response
```

`apps/benchmarks` needs its own first-time install (Bun workspaces aren't
used):

```console
$ bun install --cwd apps/benchmarks
```

## Scripts

| Script                | Does                                                    |
| ---------------------- | -------------------------------------------------------- |
| `bun run build`         | Build `dist/` (Node/browser/CJS entry points)             |
| `bun test`              | Run the test suite                                        |
| `bun run typecheck`     | Regenerate example declarations, then `tsc --noEmit`       |
| `bun run lint`          | `oxlint .`                                                 |
| `bun run format`        | `oxfmt .`                                                  |
| `bun run format:check`  | `oxfmt --check .`                                          |
| `bun run check`         | build + lint + format:check + test — run before opening a PR |
| `bun run bench`         | Runtime benchmarks vs jq/JSONata (`apps/benchmarks`)        |

## Commit messages

- Follow [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): subject`, imperative mood, lowercase subject, no trailing
  period. Scope is optional but preferred when the change is localized (e.g.
  `feat(cli): ...`, `fix(converter): ...`). Common types: `feat`, `fix`,
  `refactor`, `perf`, `chore`, `docs`, `test`, `style`.
- Don't add `Co-Authored-By` or other AI-attribution trailers.

## Before opening a PR

```console
$ bun run check
```

This runs the build, lint, format check, and test suite — the same checks
CI runs.
