/**
 * Two completion modes, neither requiring a parsed grammar — a direct port of
 * the JetBrains plugin's TypeflowCompletionContributor:
 *
 * - Bare word: the declaration keywords (`input`, `use`, `fn`, `map`, `from`,
 *   `let`) and literals (`true`, `false`, `null`).
 * - Member access (`user.`, `user.contact.`, `user.labels[0].`): re-runs
 *   `typeflow check --json` to get the `input` declaration's resolved type,
 *   then walks the member chain typed so far through that structural type to
 *   offer the actual field names.
 */
import * as vscode from 'vscode';
import { check, type TypeflowType } from './cli';

const KEYWORDS = ['input', 'use', 'fn', 'map', 'from', 'let'];
const LITERALS = ['true', 'false', 'null'];

type PathSegment = { kind: 'field'; name: string } | { kind: 'index' };

export class TypeflowCompletionProvider
  implements vscode.CompletionItemProvider
{
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const text = document.getText();
    const offset = document.offsetAt(position);

    let identStart = offset;
    while (identStart > 0 && isIdentPart(text[identStart - 1]!)) identStart--;

    const dot = prevSignificant(text, identStart);
    if (dot < 0 || text[dot] !== '.') return keywordItems();

    const chainEnd = prevSignificant(text, dot);
    if (chainEnd < 0) return undefined;
    const chain = parseMemberChain(text, chainEnd);
    if (!chain) return undefined;

    const report = await check(document);
    if (!report || report.inputName !== chain.root || !report.inputType)
      return undefined;

    let current = report.inputType;
    for (const step of chain.steps) {
      const stripped = stripNullish(current);
      if (step.kind === 'field') {
        const field = fieldsOf(stripped).find((f) => f.name === step.name);
        if (!field) return undefined;
        current = field.type;
      } else {
        const element = elementOf(stripped);
        if (!element) return undefined;
        current = element;
      }
    }

    return fieldsOf(stripNullish(current)).map(({ name, type }) => {
      const item = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.Field,
      );
      item.detail = typeToDisplay(type);
      return item;
    });
  }
}

function keywordItems(): vscode.CompletionItem[] {
  return [
    ...KEYWORDS.map(
      (keyword) =>
        new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword),
    ),
    ...LITERALS.map(
      (literal) =>
        new vscode.CompletionItem(literal, vscode.CompletionItemKind.Value),
    ),
  ];
}

function isIdentPart(c: string): boolean {
  return /[\w$]/.test(c);
}

function isIdentStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c);
}

function prevSignificant(text: string, before: number): number {
  let j = before - 1;
  while (j >= 0 && /\s/.test(text[j]!)) j--;
  return j;
}

/**
 * Parses a `root(.field | [index])*` chain ending at `chainEnd` (the index of
 * its last significant character), scanning backward. Returns the root
 * identifier and the steps in root-to-leaf order, or undefined for anything
 * this simple scan can't make sense of (calls, parens, operators — those need
 * a real parser).
 */
function parseMemberChain(
  text: string,
  chainEnd: number,
): { root: string; steps: PathSegment[] } | undefined {
  const steps: PathSegment[] = [];
  let end = chainEnd;

  for (;;) {
    if (end < 0) return undefined;
    if (text[end] === ']') {
      let depth = 1;
      let k = end - 1;
      while (k >= 0 && depth > 0) {
        if (text[k] === ']') depth++;
        else if (text[k] === '[') depth--;
        if (depth > 0) k--;
      }
      if (depth !== 0) return undefined;
      steps.push({ kind: 'index' });
      end = prevSignificant(text, k);
      continue;
    }

    if (!isIdentPart(text[end]!)) return undefined;
    let start = end;
    while (start > 0 && isIdentPart(text[start - 1]!)) start--;
    if (!isIdentStart(text[start]!)) return undefined;
    const name = text.slice(start, end + 1);

    const beforeDot = prevSignificant(text, start);
    if (beforeDot >= 0 && text[beforeDot] === '.') {
      steps.push({ kind: 'field', name });
      end = prevSignificant(text, beforeDot);
    } else {
      return { root: name, steps: steps.toReversed() };
    }
  }
}

/** Drops `null`/`undefined` from a union so member access can see through optional fields. */
function stripNullish(type: TypeflowType): TypeflowType {
  if (type.kind !== 'union' || !type.types) return type;
  const members = type.types.filter(
    (t) => t.kind !== 'null' && t.kind !== 'undefined',
  );
  if (members.length === 0) return type;
  if (members.length === 1) return members[0]!;
  return { kind: 'union', types: members };
}

function fieldsOf(type: TypeflowType): { name: string; type: TypeflowType }[] {
  switch (type.kind) {
    case 'object':
      return (type.fields ?? []).map((f) => ({ name: f.name, type: f.type }));
    // A field reachable through only some union members still gets suggested.
    case 'union': {
      const seen = new Set<string>();
      const merged: { name: string; type: TypeflowType }[] = [];
      for (const member of type.types ?? []) {
        for (const field of fieldsOf(member)) {
          if (seen.has(field.name)) continue;
          seen.add(field.name);
          merged.push(field);
        }
      }
      return merged;
    }
    default:
      return [];
  }
}

function elementOf(type: TypeflowType): TypeflowType | undefined {
  switch (type.kind) {
    case 'array':
      return type.element;
    case 'union':
      for (const member of type.types ?? []) {
        const element = elementOf(member);
        if (element) return element;
      }
      return undefined;
    default:
      return undefined;
  }
}

function typeToDisplay(type: TypeflowType): string {
  switch (type.kind) {
    case 'object':
      return '{ … }';
    case 'array':
      return `${type.element ? typeToDisplay(type.element) : 'unknown'}[]`;
    case 'union':
      return (type.types ?? []).map(typeToDisplay).join(' | ');
    case 'literal':
      return type.value !== undefined ? JSON.stringify(type.value) : 'literal';
    case undefined:
      return 'unknown';
    default:
      return type.kind;
  }
}
