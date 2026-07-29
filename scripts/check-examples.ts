/**
 * Minimal, standalone check + declaration-drift validation for
 * examples/**\/*.typeflow — replaces `bun apps/cli/src/main.ts check/types`
 * now that the CLI lives in its own repo (github.com/typeflow/cli). Not a
 * general-purpose tool, just enough to keep examples/ honest without a real
 * (and, until published, unresolvable) dependency on @typeflowjs/cli.
 *
 * Usage: bun scripts/check-examples.ts <check|types> [--check]
 */
import {
  compile,
  createTypeScriptResolver,
  emitDts,
  formatDiagnostic,
} from '../src/index';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const [, , mode, ...rest] = process.argv;
const checkOnly = rest.includes('--check');

if (mode !== 'check' && mode !== 'types') {
  console.error('Usage: bun scripts/check-examples.ts <check|types> [--check]');
  process.exit(1);
}

const glob = new Bun.Glob('examples/**/*.typeflow');
const files = (await Array.fromAsync(glob.scan('.')))
  .map((f) => resolve(f))
  .toSorted();

if (files.length === 0) {
  console.error('No .typeflow files found under examples/.');
  process.exit(1);
}

const resolver = createTypeScriptResolver();
let errors = 0;
let warnings = 0;
let drift = 0;

for (const filePath of files) {
  const source = await readFile(filePath, 'utf8');
  const fileName = relative(process.cwd(), filePath).replace(/\\/g, '/');
  const result = compile(source, {
    fileName,
    filePath,
    resolveType: resolver,
  });
  for (const d of result.diagnostics) {
    console.error(formatDiagnostic(d, source, fileName));
    if (d.severity === 'error') errors++;
    else warnings++;
  }

  if (mode === 'types' && errors === 0) {
    const dtsPath = filePath.replace(/\.typeflow$/, '.d.typeflow.ts');
    const expected = emitDts(result, { sourceFileName: fileName });
    if (checkOnly) {
      const actual = existsSync(dtsPath)
        ? await readFile(dtsPath, 'utf8')
        : null;
      if (actual !== expected) {
        drift++;
        console.error(
          `stale declarations: ${relative(process.cwd(), dtsPath)}`,
        );
      }
    } else {
      await writeFile(dtsPath, expected, 'utf8');
    }
  }
}

if (errors > 0) {
  console.error(`✖ ${files.length} mapping(s) checked, ${errors} error(s).`);
  process.exit(1);
}
if (mode === 'types' && checkOnly) {
  if (drift > 0) process.exit(1);
  console.log(`✔ ${files.length} declaration file(s) up to date.`);
} else {
  const suffix = warnings ? `, ${warnings} warning(s)` : '';
  console.log(`✔ ${files.length} mapping(s) checked, 0 errors${suffix}.`);
}
