/**
 * Build for npm: cargo builds the Rust addon (release, LTO), the artifact is
 * copied next to the package root under its platform name, then `Bun.build`
 * bundles index.ts into dist/ in BOTH module formats — ESM (`.js`) and
 * CommonJS (`.cjs`) — like the main typeflow package. Run with: bun run build
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

const cargo = Bun.spawnSync(['cargo', 'build', '--release'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (cargo.exitCode !== 0) {
  console.error('✖ cargo build failed');
  process.exit(1);
}

const artifacts: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'typeflow_converters.dll',
  darwin: 'libtypeflow_converters.dylib',
  linux: 'libtypeflow_converters.so',
};
const artifact = join(root, 'target', 'release', artifacts[process.platform]!);
if (!existsSync(artifact)) {
  console.error(`✖ build artifact not found: ${artifact}`);
  process.exit(1);
}
const nodeFile = join(
  root,
  `typeflow-converters.${process.platform}-${process.arch}.node`,
);
copyFileSync(artifact, nodeFile);
console.log(`✔ addon built: ${nodeFile}`);

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
