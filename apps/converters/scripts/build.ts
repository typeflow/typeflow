/**
 * Build for npm: `napi build` (via @napi-rs/cli) builds the Rust addon for
 * the host target and writes it next to the package root with the
 * ABI-suffixed platform name apps/converters/index.ts's loader expects
 * (e.g. `typeflow-converters.win32-x64-msvc.node`). napi also insists on
 * generating its own raw-binding `.d.ts`/JS loader alongside it — redirected
 * to throwaway filenames and deleted, since index.ts (hand-maintained, with
 * a friendlier wrapped API) is this package's real entry point and its own
 * index.d.ts must NOT be clobbered by napi's raw native-binding types. Cross
 * target builds (used by the release CI matrix) pass `--target <triple>`
 * directly to `napi build`, bypassing this script. Then `Bun.build` bundles
 * index.ts into dist/ in BOTH module formats — ESM (`.js`) and CommonJS
 * (`.cjs`) — like the main typeflow package. Run with: bun run build
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));

const rawDts = join(root, 'native-bindings.d.ts');
const rawJs = join(root, 'native-bindings.js');
const napi = Bun.spawnSync(
  [
    'bunx',
    'napi',
    'build',
    '--platform',
    '--release',
    '--dts',
    'native-bindings.d.ts',
    '--js',
    'native-bindings.js',
  ],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
);
rmSync(rawDts, { force: true });
rmSync(rawJs, { force: true });
if (napi.exitCode !== 0) {
  console.error('✖ napi build failed');
  process.exit(1);
}

rmSync(join(root, 'dist'), { recursive: true, force: true });

const esm = await Bun.build({
  entrypoints: [join(root, 'index.ts')],
  outdir: join(root, 'dist'),
  target: 'node',
  format: 'esm',
  splitting: false,
});

const cjs = await Bun.build({
  entrypoints: [join(root, 'index.ts')],
  outdir: join(root, 'dist'),
  target: 'node',
  format: 'cjs',
  splitting: false,
  naming: '[dir]/[name].cjs',
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
