import { type Token, tokenize } from '../../../src/parser/index';

const KEYWORDS = new Set(['input', 'use', 'fn', 'map', 'from', 'let']);
const LITERALS = new Set(['true', 'false', 'null']);
const TYPES = new Set(['string', 'number', 'boolean', 'unknown']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function classify(tokens: Token[], idx: number): string {
  const t = tokens[idx]!;
  switch (t.type) {
    case 'comment':
      return 'tok-comment';
    case 'string':
      return 'tok-string';
    case 'number':
      return 'tok-number';
    case 'error':
      return 'tok-error';
    case 'punct':
      return 'tok-punct';
    case 'ident': {
      const next = tokens[idx + 1];
      const prev = tokens[idx - 1];
      // Property position: `{ name: ...` / `, name?: ...`
      if (
        (prev === undefined ||
          (prev.type === 'punct' &&
            (prev.value === '{' || prev.value === ','))) &&
        next?.type === 'punct' &&
        (next.value === ':' ||
          (next.value === '?' && tokens[idx + 2]?.value === ':'))
      ) {
        return 'tok-prop';
      }
      if (next?.type === 'punct' && next.value === '(') return 'tok-fn';
      if (KEYWORDS.has(t.value)) return 'tok-keyword';
      if (LITERALS.has(t.value)) return 'tok-literal';
      if (TYPES.has(t.value)) return 'tok-type';
      return 'tok-ident';
    }
    default:
      return '';
  }
}

/** Highlight Typeflow source using the real lexer in tolerant mode. */
export function highlightTypeflow(source: string): string {
  const tokens = tokenize(source, { includeComments: true, tolerant: true });
  let html = '';
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'eof') break;
    html += escapeHtml(source.slice(pos, t.start));
    const cls = classify(tokens, i);
    const text = source.slice(t.start, t.end);
    html += cls ? span(cls, text) : escapeHtml(text);
    pos = t.end;
  }
  return html + escapeHtml(source.slice(pos));
}

const JSON_NUM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/;

/** Highlight JSON (plus `//` comment lines used by the output pane for messages). */
export function highlightJson(source: string): string {
  let html = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === '/' && source[i + 1] === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      html += span('tok-comment', source.slice(i, j));
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== '"') {
        if (source[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      let k = j;
      while (k < n && (source[k] === ' ' || source[k] === '\t')) k++;
      html += span(
        source[k] === ':' ? 'tok-prop' : 'tok-string',
        source.slice(i, j),
      );
      i = j;
      continue;
    }
    const rest = source.slice(i);
    const num =
      c === '-' || (c >= '0' && c <= '9') ? rest.match(JSON_NUM) : null;
    if (num) {
      html += span('tok-number', num[0]);
      i += num[0].length;
      continue;
    }
    const word = /^(true|false|null)\b/.exec(rest);
    if (word) {
      html += span('tok-literal', word[0]);
      i += word[0].length;
      continue;
    }
    if ('{}[]:,'.includes(c)) {
      html += span('tok-punct', c);
      i++;
      continue;
    }
    html += escapeHtml(c);
    i++;
  }
  return html;
}
