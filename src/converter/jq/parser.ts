/**
 * Minimal jq parser for the mapping subset the converter can translate:
 * field paths, object/array constructors, pipes, comparisons, arithmetic,
 * boolean operators, and common filter calls such as map/select/sort_by.
 */

export class ConvertError extends Error {}

export type QNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'input' }
  | { kind: 'field'; target: QNode; name: string }
  | { kind: 'index'; target: QNode; index: QNode }
  | { kind: 'iterate'; target: QNode }
  | { kind: 'call'; name: string; args: QNode[] }
  | { kind: 'pipe'; left: QNode; right: QNode }
  | { kind: 'binary'; op: string; left: QNode; right: QNode }
  | { kind: 'unary'; op: 'not' | '-'; expr: QNode }
  | { kind: 'object'; pairs: { key: string; value: QNode }[] }
  | { kind: 'array'; items: QNode[] };

interface QToken {
  type: 'num' | 'str' | 'name' | 'punct' | 'eof';
  value: string;
}

const PUNCT2 = new Set(['==', '!=', '<=', '>=', '//']);
const PUNCT1 = '{}[](),:.|+-*/%<>';

function lex(source: string): QToken[] {
  const tokens: QToken[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '#') {
      const end = source.indexOf('\n', i + 1);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < source.length && /[0-9.eE+-]/.test(source[j]!)) {
        if (
          (source[j] === '+' || source[j] === '-') &&
          !/[eE]/.test(source[j - 1]!)
        )
          break;
        j++;
      }
      const raw = source.slice(i, j);
      tokens.push({ type: 'num', value: String(Number.parseFloat(raw)) });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = '';
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\') {
          const escaped = source[j + 1];
          if (escaped === undefined) throw new ConvertError('Unterminated string literal.');
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          j += 2;
        } else {
          value += source[j]!;
          j++;
        }
      }
      if (j >= source.length) throw new ConvertError('Unterminated string literal.');
      tokens.push({ type: 'str', value });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ type: 'name', value: source.slice(i, j) });
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (PUNCT2.has(two)) {
      tokens.push({ type: 'punct', value: two });
      i += 2;
      continue;
    }
    if (PUNCT1.includes(c)) {
      tokens.push({ type: 'punct', value: c });
      i++;
      continue;
    }
    throw new ConvertError(`Unexpected character '${c}'.`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

class QParser {
  private pos = 0;

  constructor(private tokens: QToken[]) {}

  private peek(): QToken {
    return this.tokens[this.pos]!;
  }

  private next(): QToken {
    const token = this.peek();
    if (token.type !== 'eof') this.pos++;
    return token;
  }

  private at(value: string): boolean {
    const token = this.peek();
    return (token.type === 'punct' || token.type === 'name') && token.value === value;
  }

  private eat(value: string): boolean {
    if (!this.at(value)) return false;
    this.pos++;
    return true;
  }

  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new ConvertError(
        `Expected '${value}' but found '${this.peek().value || 'end of input'}'.`,
      );
    }
  }

  parse(): QNode {
    const expr = this.parsePipe();
    if (this.peek().type !== 'eof') {
      throw new ConvertError(`Unsupported jq construct near '${this.peek().value}'.`);
    }
    return expr;
  }

  private parsePipe(): QNode {
    let left = this.parseFallback();
    while (this.eat('|')) {
      left = { kind: 'pipe', left, right: this.parseFallback() };
    }
    return left;
  }

  private parseFallback(): QNode {
    return this.parseBinary(['//'], this.parseOr);
  }

  private parseBinary(ops: string[], nextLevel: () => QNode): QNode {
    let left = nextLevel.call(this);
    for (;;) {
      const token = this.peek();
      const isOp =
        (token.type === 'punct' || token.type === 'name') && ops.includes(token.value);
      if (!isOp) return left;
      this.next();
      left = { kind: 'binary', op: token.value, left, right: nextLevel.call(this) };
    }
  }

  private parseOr(): QNode {
    return this.parseBinary(['or'], this.parseAnd);
  }

  private parseAnd(): QNode {
    return this.parseBinary(['and'], this.parseComparison);
  }

  private parseComparison(): QNode {
    return this.parseBinary(['==', '!=', '<', '<=', '>', '>='], this.parseAdditive);
  }

  private parseAdditive(): QNode {
    return this.parseBinary(['+', '-'], this.parseMultiplicative);
  }

  private parseMultiplicative(): QNode {
    return this.parseBinary(['*', '/', '%'], this.parseUnary);
  }

  private parseUnary(): QNode {
    if (this.eat('not')) return { kind: 'unary', op: 'not', expr: this.parseUnary() };
    if (this.eat('-')) return { kind: 'unary', op: '-', expr: this.parseUnary() };
    return this.parsePostfix();
  }

  private parsePostfix(): QNode {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.eat('.')) {
        const token = this.peek();
        if (token.type === 'name') {
          this.next();
          expr = { kind: 'field', target: expr, name: token.value };
          continue;
        }
        if (token.type === 'str') {
          this.next();
          expr = { kind: 'field', target: expr, name: token.value };
          continue;
        }
        if (this.at('[')) continue;
        throw new ConvertError(`Unsupported path step after '.': '${token.value}'.`);
      }
      if (this.eat('[')) {
        if (this.eat(']')) {
          expr = { kind: 'iterate', target: expr };
          continue;
        }
        const index = this.parsePipe();
        this.expect(']');
        expr = { kind: 'index', target: expr, index };
        continue;
      }
      return expr;
    }
  }

  private parsePrimary(): QNode {
    const token = this.peek();
    if (token.type === 'num') {
      this.next();
      return { kind: 'num', value: Number(token.value) };
    }
    if (token.type === 'str') {
      this.next();
      return { kind: 'str', value: token.value };
    }
    if (token.type === 'name') {
      this.next();
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'bool', value: token.value === 'true' };
      }
      if (token.value === 'null') return { kind: 'null' };
      if (this.eat('(')) {
        const args: QNode[] = [];
        while (!this.at(')')) {
          args.push(this.parsePipe());
          if (!this.eat(',')) break;
        }
        this.expect(')');
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'call', name: token.value, args: [] };
    }
    if (this.eat('.')) {
      let expr: QNode = { kind: 'input' };
      const next = this.peek();
      if (next.type === 'name') {
        this.next();
        expr = { kind: 'field', target: expr, name: next.value };
      } else if (next.type === 'str') {
        this.next();
        expr = { kind: 'field', target: expr, name: next.value };
      }
      return expr;
    }
    if (this.eat('{')) return this.parseObjectBody();
    if (this.eat('[')) {
      const items: QNode[] = [];
      while (!this.at(']')) {
        items.push(this.parsePipe());
        if (!this.eat(',')) break;
      }
      this.expect(']');
      return { kind: 'array', items };
    }
    if (this.eat('(')) {
      const expr = this.parsePipe();
      this.expect(')');
      return expr;
    }
    throw new ConvertError(
      `Unsupported jq construct near '${token.value || 'end of input'}'.`,
    );
  }

  private parseObjectBody(): QNode {
    const pairs: { key: string; value: QNode }[] = [];
    while (!this.at('}')) {
      const key = this.peek();
      if (key.type !== 'name' && key.type !== 'str') {
        throw new ConvertError('Only literal object keys are supported by the jq converter.');
      }
      this.next();
      if (this.eat(':')) {
        pairs.push({ key: key.value, value: this.parsePipe() });
      } else {
        pairs.push({
          key: key.value,
          value: { kind: 'field', target: { kind: 'input' }, name: key.value },
        });
      }
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return { kind: 'object', pairs };
  }
}

export function parseJq(source: string): QNode {
  return new QParser(lex(source)).parse();
}
