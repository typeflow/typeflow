import type { Diagnostic } from "@thomasfarineau/typeflow-core";

export type TokenType = "ident" | "number" | "string" | "punct" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export class LexError extends Error {
  constructor(public diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

const MULTI_PUNCT = ["?.", "??", "->", "==", "!=", "<=", ">=", "&&", "||"];
const SINGLE_PUNCT = "{}[](),:.?|!+-*/<>";

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  const fail = (message: string, start: number, end: number): never => {
    throw new LexError({ code: "TF1001", message, span: { start, end }, severity: "error" });
  };

  while (i < n) {
    const c = source[i]!;

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    // Comments: `//` and `#` to end of line.
    if (c === "#" || (c === "/" && source[i + 1] === "/")) {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    const start = i;

    if (isIdentStart(c)) {
      while (i < n && isIdentPart(source[i]!)) i++;
      tokens.push({ type: "ident", value: source.slice(start, i), start, end: i });
      continue;
    }

    if (isDigit(c)) {
      while (i < n && isDigit(source[i]!)) i++;
      if (source[i] === "." && isDigit(source[i + 1] ?? "")) {
        i++;
        while (i < n && isDigit(source[i]!)) i++;
      }
      if (source[i] === "e" || source[i] === "E") {
        let j = i + 1;
        if (source[j] === "+" || source[j] === "-") j++;
        if (isDigit(source[j] ?? "")) {
          i = j;
          while (i < n && isDigit(source[i]!)) i++;
        }
      }
      tokens.push({ type: "number", value: source.slice(start, i), start, end: i });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let value = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\n") fail("Unterminated string literal.", start, i);
        if (source[i] === "\\") {
          const esc = source[i + 1];
          switch (esc) {
            case "n": value += "\n"; break;
            case "t": value += "\t"; break;
            case "r": value += "\r"; break;
            case "\\": value += "\\"; break;
            case '"': value += '"'; break;
            case "'": value += "'"; break;
            default:
              fail(`Unknown escape sequence '\\${esc ?? ""}'.`, i, i + 2);
          }
          i += 2;
        } else {
          value += source[i];
          i++;
        }
      }
      if (i >= n) fail("Unterminated string literal.", start, n);
      i++; // closing quote
      tokens.push({ type: "string", value, start, end: i });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (MULTI_PUNCT.includes(two)) {
      tokens.push({ type: "punct", value: two, start, end: i + 2 });
      i += 2;
      continue;
    }
    if (SINGLE_PUNCT.includes(c)) {
      tokens.push({ type: "punct", value: c, start, end: i + 1 });
      i++;
      continue;
    }

    fail(`Unexpected character '${c}'.`, i, i + 1);
  }

  tokens.push({ type: "eof", value: "", start: n, end: n });
  return tokens;
}
