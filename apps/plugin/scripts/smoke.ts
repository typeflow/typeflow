/**
 * End-to-end smoke test of every supported environment, against real
 * runtimes and real toolchains:
 *
 *   1. node --import dist/register.js  → plain-JS ESM import
 *   2. node --import dist/register.js  → plain-JS CJS require()
 *   3. bun  --preload dist/bun.js      → JS ESM import under Bun
 *   4. tsc (real tsconfig, typed via the .d.typeflow.ts sidecar) → emitted
 *      ESM run under node --import
 *   5. tsc → emitted CommonJS (.cts → .cjs) run under node --import
 *   6. bun  --preload dist/bun.js      → TypeScript entry under Bun
 *   7. vite build with @typeflow/plugin/vite → bundle runs standalone
 *   8. tsx (composed hooks: ours + tsx's, one node invocation)
 *   9. ts-node CJS (-r ts-node/register + our --import, own tsconfig)
 *
 * Needs the repo root built first (`bun scripts/build.ts` at the root):
 * under Node the generated modules resolve typeflow-js/runtime to dist/.
 * Run with: bun run test (builds this package, then runs this).
 */
import { compile, createTypeScriptResolver, emitDts } from 'typeflow-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { join } from 'node:path';
import typeflow from '../src/vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(root, '..', '..');
const fixtures = join(root, 'test', 'fixtures');
const tsApp = join(root, 'test', 'ts-app');
const viteApp = join(root, 'test', 'vite-app');

if (!existsSync(join(repoRoot, 'dist', 'runtime', 'index.js'))) {
  console.error(
    '✖ repo root dist/ missing — run `bun scripts/build.ts` at the repo root first',
  );
  process.exit(1);
}

// The typed-tsc path needs the .d.typeflow.ts sidecar (what `typeflow types`
// generates); produce it here so the fixture stays a single source file.
{
  const mappingPath = join(fixtures, 'user.typeflow');
  const result = compile(readFileSync(mappingPath, 'utf8'), {
    fileName: 'user.typeflow',
    filePath: mappingPath,
    resolveType: createTypeScriptResolver(),
  });
  if (!result.ok) {
    console.error('✖ fixture does not compile');
    process.exit(1);
  }
  writeFileSync(
    join(fixtures, 'user.d.typeflow.ts'),
    emitDts(result, { sourceFileName: 'user.typeflow' }),
    'utf8',
  );
}

const registerUrl = pathToFileURL(join(root, 'dist', 'register.js')).href;
const bunPreload = join(root, 'dist', 'bun.js');

function run(label: string, cmd: string[], cwd: string = root): boolean {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stdout = proc.stdout.toString().trim();
  const stderr = proc.stderr.toString().trim();
  if (proc.exitCode === 0) {
    console.log(`✔ ${label}${stdout ? `: ${stdout}` : ''}`);
    return true;
  }
  console.error(`✖ ${label} (exit ${proc.exitCode})\n${stdout}\n${stderr}`);
  return false;
}

let failures = 0;
const check = (ok: boolean) => {
  if (!ok) failures++;
};

// 1-3: plain JS, both module systems, both runtimes.
check(
  run('node esm import', [
    'node',
    '--import',
    registerUrl,
    join(root, 'test', 'esm.mjs'),
  ]),
);
check(
  run('node cjs require', [
    'node',
    '--import',
    registerUrl,
    join(root, 'test', 'cjs.cjs'),
  ]),
);
check(
  run('bun esm import', [
    'bun',
    '--preload',
    bunPreload,
    join(root, 'test', 'esm.mjs'),
  ]),
);

// 4-5: "normal TypeScript" — tsc with a real tsconfig (typed sidecar import),
// then the emitted JS runs under the Node hooks.
check(run('tsc typecheck+emit', ['bun', 'x', 'tsc', '-p', tsApp]));
check(
  run('tsc-emitted esm', [
    'node',
    '--import',
    registerUrl,
    join(tsApp, 'app-esm.js'),
  ]),
);
check(
  run('tsc-emitted cjs', [
    'node',
    '--import',
    registerUrl,
    join(tsApp, 'app-cjs.cjs'),
  ]),
);

// 6: TypeScript directly under Bun.
check(
  run('bun ts import', [
    'bun',
    '--preload',
    bunPreload,
    join(tsApp, 'app-esm.ts'),
  ]),
);

// 8: tsx — its hooks and ours chain in one node invocation.
check(
  run('tsx import', [
    'node',
    '--import',
    registerUrl,
    '--import',
    'tsx',
    join(tsApp, 'app-esm.ts'),
  ]),
);

// 9: ts-node in CJS mode (its maintained path), from the fixture dir so
// ts-node picks up the CommonJS tsconfig there.
check(
  run(
    'ts-node cjs',
    ['node', '-r', 'ts-node/register', '--import', registerUrl, 'app.ts'],
    join(root, 'test', 'tsnode-app'),
  ),
);

// 7: Vite build with the plugin, bundle runs standalone (no hooks).
try {
  await build({
    configFile: false,
    logLevel: 'error',
    root: viteApp,
    plugins: [typeflow()],
    build: {
      outDir: join(viteApp, 'out'),
      emptyOutDir: true,
      minify: false,
      target: 'esnext',
      lib: {
        entry: join(viteApp, 'entry.ts'),
        formats: ['es'],
        fileName: () => 'bundle.mjs',
      },
      rollupOptions: { external: [/^node:/] },
    },
  });
  check(run('vite bundle', ['node', join(viteApp, 'out', 'bundle.mjs')]));
} catch (e) {
  failures++;
  console.error(`✖ vite build\n${e instanceof Error ? e.message : String(e)}`);
}

if (failures > 0) process.exit(1);
console.log(
  '✔ full matrix verified: node esm/cjs, bun js/ts, tsc esm/cjs, tsx, ts-node, vite',
);
