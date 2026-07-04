/** Per-file compilation reports and their console presentation. */
import {
  compile,
  type CompileResult,
  emitDts,
  type TypeResolver,
} from '../compiler';
import { type Diagnostic, formatDiagnostic, typeToString } from '../core';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createTypeScriptResolver } from '../adapter';

export const color = process.stderr.isTTY ?? false;

export interface FileReport {
  filePath: string;
  fileName: string;
  source: string;
  result: CompileResult;
}

export async function compileFile(
  filePath: string,
  resolver?: TypeResolver,
): Promise<FileReport> {
  const abs = resolve(filePath);
  const source = await readFile(abs, 'utf8');
  const fileName = relative(process.cwd(), abs).replace(/\\/g, '/');
  const result = compile(source, {
    fileName,
    filePath: abs,
    resolveType: resolver ?? createTypeScriptResolver(),
  });
  return { filePath: abs, fileName, source, result };
}

export function printDiagnostics(report: FileReport, useColor = color): void {
  for (const d of report.result.diagnostics) {
    console.error(
      formatDiagnostic(d, report.source, report.fileName, { color: useColor }),
    );
  }
}

export function countBySeverity(diagnostics: Diagnostic[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** `user.typeflow` → `user.d.typeflow.ts` (TypeScript's `allowArbitraryExtensions` convention). */
export function dtsPathFor(filePath: string): string {
  return filePath.replace(/\.typeflow$/, '.d.typeflow.ts');
}

export async function writeDts(report: FileReport): Promise<string> {
  const dts = emitDts(report.result, { sourceFileName: report.fileName });
  const outPath = dtsPathFor(report.filePath);
  await writeFile(outPath, dts, 'utf8');
  return outPath;
}

export function inferredOutput(report: FileReport): string {
  return report.result.outputType
    ? typeToString(report.result.outputType)
    : 'unknown';
}
