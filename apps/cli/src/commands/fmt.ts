/** `fmt` — rewrite mappings in canonical form. */
import { format, formatDiagnostic } from 'typeflowjs';
import { readFile, writeFile } from 'node:fs/promises';
import { color } from '#reports';
import { expandFiles } from '#glob';
import { relative } from 'node:path';

export async function cmdFmt(
  patterns: string[],
  checkOnly: boolean,
): Promise<void> {
  const files = await expandFiles(patterns);
  if (files.length === 0) {
    console.error('No .typeflow files found.');
    process.exit(1);
  }
  let changed = 0;
  let failed = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    const source = await readFile(file, 'utf8');
    const result = format(source);
    if (!result.ok) {
      failed++;
      for (const d of result.diagnostics)
        console.error(formatDiagnostic(d, source, rel, { color }));
      continue;
    }
    if (result.formatted === source) continue;
    changed++;
    if (checkOnly) {
      console.error(`not formatted: ${rel}`);
    } else {
      await writeFile(file, result.formatted, 'utf8');
      console.log(`formatted ${rel}`);
    }
  }
  if (failed > 0 || (checkOnly && changed > 0)) process.exit(1);
  if (changed === 0)
    console.log(`✔ ${files.length} file(s) already formatted.`);
}
