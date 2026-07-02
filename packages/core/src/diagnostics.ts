import type { Span } from "./ast.ts";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  message: string;
  span: Span;
  severity: Severity;
  hint?: string;
}

export interface LineCol {
  line: number; // 1-based
  col: number; // 1-based
}

export function offsetToLineCol(source: string, offset: number): LineCol {
  let line = 1;
  let lineStart = 0;
  const max = Math.min(offset, source.length);
  for (let i = 0; i < max; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

export interface FormatOptions {
  color?: boolean;
}

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

/** tsc-style rendering: `file:line:col - error TF2002: ...` plus a source excerpt with carets. */
export function formatDiagnostic(
  d: Diagnostic,
  source: string,
  fileName: string,
  options: FormatOptions = {},
): string {
  const color = options.color ?? false;
  const c = (code: string, s: string) => (color ? code + s + RESET : s);

  const { line, col } = offsetToLineCol(source, d.span.start);
  const sevColor = d.severity === "error" ? RED : YELLOW;
  const header =
    `${c(CYAN, fileName)}:${line}:${col} - ` +
    `${c(sevColor, d.severity)} ${c(DIM, d.code)}: ${d.message}`;

  const lineStart = source.lastIndexOf("\n", d.span.start - 1) + 1;
  let lineEnd = source.indexOf("\n", d.span.start);
  if (lineEnd === -1) lineEnd = source.length;
  const lineText = source.slice(lineStart, lineEnd).replace(/\t/g, " ");

  const gutter = String(line);
  const caretStart = d.span.start - lineStart;
  const caretLen = Math.max(1, Math.min(d.span.end, lineEnd) - d.span.start);
  const excerpt =
    `${c(DIM, gutter)}  ${lineText}\n` +
    `${" ".repeat(gutter.length)}  ${" ".repeat(caretStart)}${c(sevColor, "~".repeat(caretLen))}`;

  const hint = d.hint ? `\n  ${c(DIM, "hint:")} ${d.hint}` : "";
  return `${header}\n\n${excerpt}${hint}\n`;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...new Array<number>(n)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Closest candidate within an edit-distance budget, for "Did you mean ...?" suggestions. */
export function suggestName(name: string, candidates: Iterable<string>): string | undefined {
  const budget = Math.max(2, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestDist = budget + 1;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const d = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return bestDist <= budget ? best : undefined;
}
