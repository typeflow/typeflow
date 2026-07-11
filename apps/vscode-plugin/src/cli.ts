/**
 * Shells out to `typeflow check --json <file>` (see apps/cli), shared by the
 * diagnostics provider and the completion provider — the same split as the
 * JetBrains plugin's TypeflowCli.kt. No persistent process: each call is a
 * fresh, independent `typeflow` run against the file on disk, with a short
 * TTL cache so typing out a member chain doesn't hammer the CLI.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { exec } from 'node:child_process';

export interface TypeflowSpan {
  start: number;
  end: number;
}

export interface TypeflowDiagnostic {
  code: string;
  message: string;
  span: TypeflowSpan;
  severity: string;
  hint?: string;
}

/**
 * The structural type model from src/core/types.ts, kept as a loose shape
 * (`kind`-tagged union) rather than a full port — the providers only walk
 * objects/arrays/unions.
 */
export interface TypeflowType {
  kind?: string;
  fields?: { name: string; type: TypeflowType }[];
  element?: TypeflowType;
  types?: TypeflowType[];
  value?: unknown;
}

export interface TypeflowFileReport {
  file: string;
  diagnostics: TypeflowDiagnostic[];
  inputName?: string;
  inputType?: TypeflowType;
}

const output = vscode.window.createOutputChannel('Typeflow');

const CACHE_TTL_MS = 2000;
const cache = new Map<
  string,
  { at: number; report: TypeflowFileReport | undefined }
>();

/** Drop the cached report for a file (call on save, before re-checking). */
export function invalidate(filePath: string): void {
  cache.delete(filePath);
}

export function check(
  document: vscode.TextDocument,
): Promise<TypeflowFileReport | undefined> {
  const filePath = document.uri.fsPath;
  const cached = cache.get(filePath);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS)
    return Promise.resolve(cached.report);

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(filePath);
  const bin =
    vscode.workspace.getConfiguration('typeflow').get<string>('path')?.trim() ||
    'typeflow';
  // exec (a shell) rather than execFile so PATH shims resolve on every
  // platform (npm's typeflow.cmd on Windows in particular); the path is the
  // only interpolated value and JSON.stringify quotes it.
  const command = `${bin} check ${JSON.stringify(filePath)} --json`;

  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 10_000 }, (error, stdout) => {
      // `check` exits 1 when the mapping has errors but still prints the JSON
      // report — a non-zero exit only matters when there is no usable output.
      let report: TypeflowFileReport | undefined;
      try {
        const reports = JSON.parse(stdout) as TypeflowFileReport[];
        report = reports[0];
      } catch {
        output.appendLine(
          `typeflow check failed — is the CLI on PATH (or set typeflow.path)? ${error ?? ''}`,
        );
      }
      cache.set(filePath, { at: Date.now(), report });
      resolve(report);
    });
  });
}
