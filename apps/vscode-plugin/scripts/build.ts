/**
 * Bundles src/extension.ts into a single CommonJS file at dist/extension.js
 * (VS Code's extension host loads CJS; `vscode` is provided by the host and
 * must stay external). Run with: bun run build
 */
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}dist`, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [`${root}src/extension.ts`],
  outdir: `${root}dist`,
  root: `${root}src`,
  target: 'node',
  format: 'cjs',
  splitting: false,
  external: ['vscode'],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`✔ bundled ${result.outputs.length} file(s)`);
