/**
 * Bundles the four entry points into dist/ as ESM. `typeflowjs` (and its
 * `typescript` peer) stay external — resolved from the consumer's
 * node_modules at runtime, exactly like a real npm install would.
 * Run with: bun run build
 */
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}dist`, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    `${root}src/index.ts`,
    `${root}src/register.ts`,
    `${root}src/loader.ts`,
    `${root}src/bun.ts`,
    `${root}src/vite.ts`,
  ],
  outdir: `${root}dist`,
  root: `${root}src`,
  target: 'node',
  format: 'esm',
  splitting: false,
  external: ['typeflowjs', 'typeflowjs/runtime', 'typescript', 'bun'],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`✔ bundled ${result.outputs.length} file(s)`);
