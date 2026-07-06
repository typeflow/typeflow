/**
 * Build for npm: `bun build` bundles the JS entrypoints into dist/, in BOTH
 * module formats — ESM (`.js`, the default) and CommonJS (`.cjs`) — so the
 * package works whether it is `import`ed or `require`d from plain JavaScript.
 * Then `tsc --emitDeclarationOnly` emits the .d.ts tree into dist/types/.
 * Run with: bun run build
 */
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}dist`, { recursive: true, force: true });

// Library entries ship in both module formats; the CLI is an ESM `node` bin.
const libEntries = [
  `${root}src/index.ts`,
  `${root}src/runtime/index.ts`,
  `${root}src/converter/index.ts`,
  `${root}src/converter/jsonata/index.ts`,
  `${root}src/converter/jq/index.ts`,
];
// The TS adapter loads the consumer's own TypeScript; never bundle it.
const external = ['typescript'];

const esm = await Bun.build({
  entrypoints: [...libEntries, `${root}src/cli/main.ts`],
  outdir: `${root}dist`,
  root: `${root}src`,
  target: 'node',
  format: 'esm',
  splitting: false,
  external,
});

const cjs = await Bun.build({
  entrypoints: libEntries,
  outdir: `${root}dist`,
  root: `${root}src`,
  target: 'node',
  format: 'cjs',
  splitting: false,
  naming: '[dir]/[name].cjs',
  external,
});

for (const result of [esm, cjs]) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}
console.log(
  `✔ bundled ${esm.outputs.length} ESM + ${cjs.outputs.length} CJS file(s)`,
);

// Ensure the CLI entry keeps its node shebang (bin scripts need it on POSIX).
const cliPath = `${root}dist/cli/main.js`;
const cli = await Bun.file(cliPath).text();
if (!cli.startsWith('#!')) {
  await Bun.write(cliPath, `#!/usr/bin/env node\n${cli}`);
}

const tsc = Bun.spawnSync(
  ['bun', 'x', 'tsc', '-p', `${root}tsconfig.build.json`],
  {
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
if (tsc.exitCode !== 0) {
  console.error('✖ declaration build failed');
  process.exit(1);
}
console.log('✔ declarations emitted to dist/types');
