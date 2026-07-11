import * as vscode from 'vscode';
import { registerDiagnostics } from './diagnostics';
import { TypeflowCompletionProvider } from './completion';

export function activate(context: vscode.ExtensionContext): void {
  registerDiagnostics(context);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'typeflow' },
      new TypeflowCompletionProvider(),
      '.',
    ),
  );
}

export function deactivate(): void {}
