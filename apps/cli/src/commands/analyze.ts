/** `check`, `types`, `infer`, `watch` — the static-analysis commands. */
import {
  compileFile,
  countBySeverity,
  dtsPathFor,
  type FileReport,
  inferredOutput,
  printDiagnostics,
  writeDts,
} from '#reports';
import { createTypeScriptResolver, emitDts } from 'typeflow-js';
import { existsSync, watch } from 'node:fs';
import { expandFiles } from '#glob';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

async function compileAll(patterns: string[]): Promise<FileReport[]> {
  const files = await expandFiles(patterns);
  if (files.length === 0) {
    console.error('No .typeflow files found.');
    process.exit(1);
  }
  const resolver = createTypeScriptResolver();
  const reports: FileReport[] = [];
  for (const file of files) {
    reports.push(await compileFile(file, resolver));
  }
  return reports;
}

function summarize(reports: FileReport[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const r of reports) {
    printDiagnostics(r);
    const c = countBySeverity(r.result.diagnostics);
    errors += c.errors;
    warnings += c.warnings;
  }
  return { errors, warnings };
}

export async function cmdCheck(
  patterns: string[],
  json = false,
): Promise<void> {
  const reports = await compileAll(patterns);

  if (json) {
    let errors = 0;
    const out = reports.map((r) => {
      errors += countBySeverity(r.result.diagnostics).errors;
      return {
        file: r.fileName,
        diagnostics: r.result.diagnostics,
        inputName: r.result.inputName,
        inputType: r.result.inputType,
      };
    });
    console.log(JSON.stringify(out));
    if (errors > 0) process.exit(1);
    return;
  }

  const { errors, warnings } = summarize(reports);
  const suffix = warnings ? `, ${warnings} warning(s)` : '';
  if (errors > 0) {
    console.error(
      `✖ ${reports.length} mapping(s) checked, ${errors} error(s)${suffix}.`,
    );
    process.exit(1);
  }
  console.log(`✔ ${reports.length} mapping(s) checked, 0 errors${suffix}.`);
}

export async function cmdTypes(
  patterns: string[],
  checkOnly: boolean,
): Promise<void> {
  const reports = await compileAll(patterns);
  const { errors } = summarize(reports);
  if (errors > 0) {
    console.error(`✖ Type generation aborted: ${errors} error(s).`);
    process.exit(1);
  }
  let drift = 0;
  for (const r of reports) {
    if (checkOnly) {
      const expected = emitDts(r.result, { sourceFileName: r.fileName });
      const outPath = dtsPathFor(r.filePath);
      const actual = existsSync(outPath)
        ? await readFile(outPath, 'utf8')
        : null;
      if (actual !== expected) {
        drift++;
        console.error(
          `stale declarations: ${relative(process.cwd(), outPath)} (run 'typeflow types')`,
        );
      }
    } else {
      const outPath = await writeDts(r);
      console.log(`generated ${relative(process.cwd(), outPath)}`);
    }
  }
  if (checkOnly) {
    if (drift > 0) process.exit(1);
    console.log(`✔ ${reports.length} declaration file(s) up to date.`);
  }
}

export async function cmdInfer(file: string | undefined): Promise<void> {
  if (!file) {
    console.error('Usage: typeflow infer <file>');
    process.exit(1);
  }
  const report = await compileFile(file);
  printDiagnostics(report);
  const { errors } = countBySeverity(report.result.diagnostics);
  if (errors > 0) process.exit(1);
  console.log(inferredOutput(report));
}

export async function cmdWatch(patterns: string[]): Promise<void> {
  const runOnce = async () => {
    try {
      const reports = await compileAll(patterns);
      const { errors, warnings } = summarize(reports);
      if (errors === 0) {
        for (const r of reports) await writeDts(r);
      }
      const time = new Date().toLocaleTimeString();
      const suffix = warnings ? `, ${warnings} warning(s)` : '';
      console.log(
        errors > 0
          ? `[${time}] ✖ ${errors} error(s)${suffix}. Waiting for changes...`
          : `[${time}] ✔ ${reports.length} mapping(s) checked, declarations updated${suffix}. Waiting for changes...`,
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
  };

  await runOnce();
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(process.cwd(), { recursive: true }, (_event, fileName) => {
    if (!fileName) return;
    const name = fileName.toString();
    if (name.includes('node_modules') || name.endsWith('.d.typeflow.ts'))
      return;
    if (!name.endsWith('.typeflow') && !name.endsWith('.ts')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(runOnce, 150);
  });
  // Keep the process alive.
  await new Promise(() => {});
}
