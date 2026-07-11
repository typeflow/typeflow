## Git commits

- Never add a `Co-Authored-By` trailer (or any other AI-attribution line) to commit messages. Thomas Farineau is the sole author.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, imperative mood, lowercase subject, no trailing period. Scope is optional but preferred when the change is localized (e.g. `feat(cli): ...`, `fix(converter): ...`). Common types: `feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `test`, `style`.
- Never bypass git hooks (`--no-verify`) or skip commit signing to force a commit through — fix the underlying issue instead, unless explicitly told otherwise.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
