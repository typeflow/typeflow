# tsx

The hooks chain with tsx's own loaders — one process handles `.ts` (tsx) and
`.typeflow` (this plugin), in whichever order the flags come:

```sh
tsx --import @typeflow/plugin/register app.ts
# equivalently:
node --import @typeflow/plugin/register --import tsx app.ts
```
