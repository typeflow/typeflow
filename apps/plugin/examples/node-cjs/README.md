# Node CommonJS

`require('./user.typeflow')` — the same `--import` flag installs the
require hook alongside the ESM loader.

```sh
node --import @typeflowjs/plugin/register app.cjs
```

Note: this mapping's `use` helper is an ESM module, which `require()` can
load synchronously on Node >= 22.12. Point `from` at a CommonJS module to
support older Node.
