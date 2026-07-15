# Vite (browser app)

`vite.config.ts` registers the plugin; the `.typeflow` import then works in
dev, build, and SSR. The mapping executes in the browser — only the compiled
artifact and `typeflow-js/runtime` ship to the client, never the compiler.

```sh
bun x vite         # dev server
bun x vite build   # production bundle → dist/
```
