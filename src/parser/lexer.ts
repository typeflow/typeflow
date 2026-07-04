import { type Diagnostic } from '../core';

export type TokenType =
  | 'ident'
  | 'number'
  | 'string'
  | 'punct'
  | 'comment'
  | 'error'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export interface TokenizeOptions {
  /** Emit comments as tokens instead of skipping them (formatter, highlighter). */
  includeComments?: boolean;
  /** Never throw: emit `error` tokens and keep scanning (highlighter on in-progress code). */
  tolerant?: boolean;
}

export class LexError extends Error {
  constructor(public diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

const MULTI_PUNCT = new Set([
  '?.',
  '??',
  '->',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
]);
const SINGLE_PUNCT = '{}[](),:.?|!+-*/%<>=^';

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

export function tokenize(
  source: string,
  options: TokenizeOptions = {},
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  const fail = (message: string, start: number, end: number): void => {
    if (options.tolerant) {
      tokens.push({
        type: 'error',
        value: source.slice(start, Math.max(end, start + 1)),
        start,
        end: Math.max(end, start + 1),
      });
      i = Math.max(end, start + 1);
      return;
    }
    throw new LexError({
      code: 'TF1001',
      message,
      span: { start, end },
      severity: 'error',
    });
  };

  while (i < n) {
    const c = source[i]!;

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    // Comments: `//` and `#` to end of line.
    if (c === '#' || (c === '/' && source[i + 1] === '/')) {
      const start = i;
      while (i < n && source[i] !== '\n') i++;
      if (options.includeComments) {
        tokens.push({
          type: 'comment',
          value: source.slice(start, i),
          start,
          end: i,
        });
      }
      continue;
    }

    const start = i;

    if (isIdentStart(c)) {
      while (i < n && isIdentPart(source[i]!)) i++;
      tokens.push({
        type: 'ident',
        value: source.slice(start, i),
        start,
        end: i,
      });
      continue;
    }

    if (isDigit(c)) {
      while (i < n && isDigit(source[i]!)) i++;
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i++;
        while (i < n && isDigit(source[i]!)) i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        let j = i + 1;
        if (source[j] === '+' || source[j] === '-') j++;
        if (isDigit(source[j] ?? '')) {
          i = j;
          while (i < n && isDigit(source[i]!)) i++;
        }
      }
      tokens.push({
        type: 'number',
        value: source.slice(start, i),
        start,
        end: i,
      });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let value = '';
      let closed = false;
      let error: string | null = null;
      while (i < n) {
        const ch = source[i]!;
        if (ch === quote) {
          i++;
          closed = true;
          break;
        }
        if (ch === '\n') break;
        if (ch === '\\') {
          const esc = source[i + 1];
          const mapped = ESCAPES[esc ?? ''];
          if (mapped === undefined) {
            error = error ?? `Unknown escape sequence '\\${esc ?? ''}'.`;
            value += esc ?? '';
            i += esc === undefined ? 1 : 2;
          } else {
            value += mapped;
            i += 2;
          }
        } else {
          value += ch;
          i++;
        }
      }
      if (!closed) error = 'Unterminated string literal.';
      if (error) {
        fail(error, start, i);
        continue;
      }
      tokens.push({ type: 'string', value, start, end: i });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (MULTI_PUNCT.has(two)) {
      tokens.push({ type: 'punct', value: two, start, end: i + 2 });
      i += 2;
      continue;
    }
    if (SINGLE_PUNCT.includes(c)) {
      tokens.push({ type: 'punct', value: c, start, end: i + 1 });
      i++;
      continue;
    }

    fail(`Unexpected character '${c}'.`, i, i + 1);
  }

  tokens.push({ type: 'eof', value: '', start: n, end: n });
  return tokens;
}
