/**
 * Runs `typeflow check --json` and turns the result into VS Code diagnostics,
 * using the diagnostic's character-offset span directly via `positionAt` — no
 * line/col conversion needed, the CLI already emits offsets. Port of the
 * JetBrains plugin's TypeflowExternalAnnotator.
 *
 * Refreshes on open and save only: the CLI reads the file from disk, so
 * checking on every keystroke would diagnose stale content anyway.
 */
import * as vscode from 'vscode';
import { check, invalidate, type TypeflowDiagnostic } from './cli';

export function registerDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('typeflow');
  context.subscriptions.push(collection);

  const refresh = async (document: vscode.TextDocument): Promise<void> => {
    if (document.languageId !== 'typeflow') return;
    const report = await check(document);
    if (!report) return;
    collection.set(
      document.uri,
      report.diagnostics.map((diagnostic) =>
        toDiagnostic(document, diagnostic),
      ),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(
      (document) => void refresh(document),
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      invalidate(document.uri.fsPath);
      void refresh(document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) =>
      collection.delete(document.uri),
    ),
  );
  for (const document of vscode.workspace.textDocuments) void refresh(document);
}

function toDiagnostic(
  document: vscode.TextDocument,
  diagnostic: TypeflowDiagnostic,
): vscode.Diagnostic {
  const docLength = document.getText().length;
  const start = Math.min(Math.max(diagnostic.span.start, 0), docLength);
  const end = Math.min(Math.max(diagnostic.span.end, start), docLength);
  const range = new vscode.Range(
    document.positionAt(start),
    document.positionAt(end),
  );
  const severity =
    diagnostic.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;
  const message = diagnostic.hint
    ? `${diagnostic.message} (${diagnostic.hint})`
    : diagnostic.message;
  const result = new vscode.Diagnostic(range, message, severity);
  result.source = 'typeflow';
  result.code = diagnostic.code;
  return result;
}
