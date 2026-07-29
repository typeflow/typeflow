/**
 * Build for npm: bundles src/main.ts into a single ESM `node` bin at
 * dist/main.js. `typescript` (loaded from the consumer's project) and the
 * two local packages (resolved at install time, see
 * scripts/link-local-deps.ts) stay external — never bundled; `commander` is
 * a plain published dependency and gets bundled in. Run with: bun run build
 */
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}dist`, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [`${root}src/main.ts`],
  outdir: `${root}dist`,
  root: `${root}src`,
  target: 'node',
  format: 'esm',
  splitting: false,
  external: ['typescript', 'typeflowjs', '@typeflow/converters'],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`✔ bundled ${result.outputs.length} file(s)`);

// Ensure the bin keeps its node shebang (bin scripts need it on POSIX).
const mainPath = `${root}dist/main.js`;
const main = await Bun.file(mainPath).text();
if (!main.startsWith('#!')) {
  await Bun.write(mainPath, `#!/usr/bin/env node\n${main}`);
}
