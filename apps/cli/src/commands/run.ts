/** `run` — execute a mapping against JSON from a file or stdin. */
import { compileFile, printDiagnostics } from '#reports';
import { createMapping, loadExternalFunctions } from 'typeflow-js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { text } from 'node:stream/consumers';

export async function cmdRun(
  file: string | undefined,
  inputPath: string | undefined,
): Promise<void> {
  if (!file) {
    console.error('Usage: typeflow run <file> [--input data.json]');
    process.exit(1);
  }
  const report = await compileFile(file);
  printDiagnostics(report);
  if (!report.result.ok || !report.result.compiled) process.exit(1);

  const raw = inputPath
    ? await readFile(resolve(inputPath), 'utf8')
    : await text(process.stdin);
  if (!raw.trim()) {
    console.error(
      'No input JSON provided (use --input <file> or pipe JSON to stdin).',
    );
    process.exit(1);
  }
  const input: unknown = JSON.parse(raw);
  const functions = await loadExternalFunctions(
    report.result.compiled,
    report.filePath,
  );
  const output = createMapping(report.result.compiled, { functions })(input);
  console.log(JSON.stringify(output, null, 2));
}
