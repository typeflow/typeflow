/**
 * Minimal JSONata parser covering the mapping subset the converter can
 * translate: object/array constructors, paths, predicates, arithmetic,
 * comparison and boolean operators, `&` concatenation, ternaries, `$fn(...)`
 * calls, and `function($x){...}` lambdas (as arguments). Anything outside the
 * subset raises a ConvertError with the offending construct.
 */

export class ConvertError extends Error {}

export type JNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'name'; value: string }
  | { kind: 'context' } // `$`
  | { kind: 'root' } // `$$`
  | { kind: 'parent'; depth: number } // `%` (depth 1), `%.%` (depth 2), …
  | { kind: 'dot'; left: JNode; right: JNode }
  | { kind: 'predicate'; target: JNode; expr: JNode }
  | { kind: 'call'; name: string; args: JNode[] }
  | { kind: 'lambda'; params: string[]; body: JNode }
  | { kind: 'bind'; target: JNode; variable: string; op: '#' | '@' }
  | { kind: 'binary'; op: string; left: JNode; right: JNode }
  | {
      kind: 'sort';
      target: JNode;
      terms: { key: JNode; descending: boolean }[];
    }
  | {
      kind: 'block';
      bindings: { name: string; value: JNode }[];
      result: JNode;
    }
  | { kind: 'ternary'; cond: JNode; then: JNode; else: JNode }
  | { kind: 'object'; pairs: { key: string; value: JNode }[] }
  | { kind: 'array'; items: JNode[] }
  | { kind: 'neg'; operand: JNode };

interface JToken {
  type: 'num' | 'str' | 'name' | 'var' | 'punct' | 'eof';
  value: string;
}

const PUNCT2 = new Set(['!=', '<=', '>=', ':=', '~>', '**']);
const PUNCT1 = '{}[](),:.?&=<>+-*/%;!@#^|';

function lex(source: string): JToken[] {
  const tokens: JToken[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new ConvertError('Unterminated comment.');
      i = end + 2;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(source[j]!)) {
        // stop at operators that only look like number parts
        if (
          (source[j] === '+' || source[j] === '-') &&
          !/[eE]/.test(source[j - 1]!)
        )
          break;
        j++;
      }
      const raw = source.slice(i, j);
      const value = Number.parseFloat(raw);
      tokens.push({ type: 'num', value: String(value) });
      i += String(raw).length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') {
          value += source[j + 1] ?? '';
          j += 2;
        } else {
          value += source[j]!;
          j++;
        }
      }
      if (j >= n) throw new ConvertError('Unterminated string literal.');
      tokens.push({ type: 'str', value });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const end = source.indexOf('`', i + 1);
      if (end === -1) throw new ConvertError('Unterminated quoted name.');
      tokens.push({ type: 'name', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      if (source[j] === '$') j++;
      while (j < n && /[A-Za-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ type: 'var', value: source.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(source[j]!)) j++;
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

class JParser {
  private pos = 0;
  constructor(private tokens: JToken[]) {}

  private peek(): JToken {
    return this.tokens[this.pos]!;
  }
  private next(): JToken {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    return t;
  }
  private at(value: string): boolean {
    const t = this.peek();
    return (t.type === 'punct' || t.type === 'name') && t.value === value;
  }
  private eat(value: string): boolean {
    if (this.at(value)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new ConvertError(
        `Expected '${value}' but found '${this.peek().value || 'end of input'}'.`,
      );
    }
  }

  parse(): JNode {
    const expr = this.parseExpr();
    if (this.peek().type !== 'eof') {
      throw new ConvertError(
        `Unsupported JSONata construct near '${this.peek().value}'.`,
      );
    }
    return expr;
  }

  parseExpr(): JNode {
    return this.parseTernary();
  }

  private parseTernary(): JNode {
    const cond = this.parseOr();
    if (!this.eat('?')) return cond;
    const then = this.parseExpr();
    this.expect(':');
    const els = this.parseExpr();
    // oxlint-disable-next-line unicorn/no-thenable -- AST data field, never awaited
    return { kind: 'ternary', cond, then, else: els };
  }

  private parseBinary(ops: string[], nextLevel: () => JNode): JNode {
    let left = nextLevel.call(this);
    for (;;) {
      const t = this.peek();
      const isWordOp = t.type === 'name' && ops.includes(t.value);
      const isPunctOp = t.type === 'punct' && ops.includes(t.value);
      if (!isWordOp && !isPunctOp) return left;
      this.next();
      const right = nextLevel.call(this);
      left = { kind: 'binary', op: t.value, left, right };
    }
  }

  private parseOr(): JNode {
    return this.parseBinary(['or'], this.parseAnd);
  }
  private parseAnd(): JNode {
    return this.parseBinary(['and'], this.parseComparison);
  }
  private parseComparison(): JNode {
    return this.parseBinary(
      ['=', '!=', '<', '<=', '>', '>=', 'in'],
      this.parseConcat,
    );
  }
  private parseConcat(): JNode {
    return this.parseBinary(['&'], this.parseAdditive);
  }
  private parseAdditive(): JNode {
    return this.parseBinary(['+', '-'], this.parseMultiplicative);
  }
  private parseMultiplicative(): JNode {
    return this.parseBinary(['*', '/', '%'], this.parseUnary);
  }

  private parseUnary(): JNode {
    if (this.eat('-')) {
      return { kind: 'neg', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): JNode {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('.')) {
        this.next();
        if (this.at('{')) {
          // `arr.{ ... }` — per-element object constructor (projection).
          expr = { kind: 'dot', left: expr, right: this.parseObject() };
          continue;
        }
        if (this.at('(')) {
          // `arr.( ... )` — per-element mapping of a block/expression; the
          // parenthesized form allows `$var := ...` bindings before the result.
          expr = { kind: 'dot', left: expr, right: this.parsePrimary() };
          continue;
        }
        const t = this.peek();
        if (t.type === 'punct' && t.value === '%') {
          // `%.%`, `%.%.%`, … — a multi-level parent. Accumulate the depth.
          if (expr.kind !== 'parent') {
            throw new ConvertError('`.%` is only valid after a `%` parent.');
          }
          this.next();
          expr = { kind: 'parent', depth: expr.depth + 1 };
          continue;
        }
        if (t.type !== 'name') {
          throw new ConvertError(
            `Unsupported path step after '.': '${t.value}'.`,
          );
        }
        this.next();
        expr = {
          kind: 'dot',
          left: expr,
          right: { kind: 'name', value: t.value },
        };
      } else if (this.at('[')) {
        this.next();
        const inner = this.parseExpr();
        this.expect(']');
        expr = { kind: 'predicate', target: expr, expr: inner };
      } else if (this.at('^')) {
        // JSONata order-by: `arr^(>a, <b)` — `>` descending, `<` (or bare) ascending.
        this.next();
        this.expect('(');
        const terms: { key: JNode; descending: boolean }[] = [];
        while (!this.at(')')) {
          let descending = false;
          if (this.eat('>')) descending = true;
          else this.eat('<');
          terms.push({ key: this.parseExpr(), descending });
          if (!this.eat(',')) break;
        }
        this.expect(')');
        if (terms.length === 0) {
          throw new ConvertError('A sort `^(...)` needs at least one key.');
        }
        expr = { kind: 'sort', target: expr, terms };
      } else if (this.at('#') || this.at('@')) {
        // `path#$i` / `path@$v` — positional / context variable binding.
        const op = this.next().value as '#' | '@';
        const t = this.peek();
        if (t.type !== 'var') {
          throw new ConvertError(`Expected a $variable after '${op}'.`);
        }
        this.next();
        expr = { kind: 'bind', target: expr, variable: t.value, op };
      } else {
        return expr;
      }
    }
  }

  private parseObject(): JNode {
    this.expect('{');
    const pairs: { key: string; value: JNode }[] = [];
    while (!this.at('}')) {
      const keyTok = this.peek();
      if (keyTok.type !== 'str' && keyTok.type !== 'name') {
        throw new ConvertError(
          'Only literal object keys are supported by the converter.',
        );
      }
      this.next();
      this.expect(':');
      const value = this.parseExpr();
      pairs.push({ key: keyTok.value, value });
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return { kind: 'object', pairs };
  }

  private parsePrimary(): JNode {
    const t = this.peek();
    if (t.type === 'num') {
      this.next();
      return { kind: 'num', value: Number(t.value) };
    }
    if (t.type === 'str') {
      this.next();
      return { kind: 'str', value: t.value };
    }
    if (t.type === 'var') {
      this.next();
      if (t.value === '$') return { kind: 'context' };
      if (t.value === '$$') return { kind: 'root' };
      // `$name(...)` is a function call; a bare `$name` is a variable (lambda param).
      if (this.at('(')) {
        this.next();
        const args: JNode[] = [];
        while (!this.at(')')) {
          args.push(this.parseArgument());
          if (!this.eat(',')) break;
        }
        this.expect(')');
        return { kind: 'call', name: t.value.slice(1), args };
      }
      return { kind: 'name', value: t.value };
    }
    if (t.type === 'name') {
      if (t.value === 'true' || t.value === 'false') {
        this.next();
        return { kind: 'bool', value: t.value === 'true' };
      }
      if (t.value === 'null') {
        this.next();
        return { kind: 'null' };
      }
      if (t.value === 'function') {
        return this.parseLambda();
      }
      this.next();
      return { kind: 'name', value: t.value };
    }
    if (this.at('(')) {
      this.next();
      // `( $x := e; ...; result )` — a block of variable bindings ending in a
      // result expression. A plain `( expr )` (no bindings) is just grouping.
      const bindings: { name: string; value: JNode }[] = [];
      let result: JNode;
      for (;;) {
        const e = this.parseExpr();
        if (this.eat(':=')) {
          if (e.kind !== 'name' || !e.value.startsWith('$')) {
            throw new ConvertError(
              'The left side of `:=` must be a $variable.',
            );
          }
          bindings.push({ name: e.value, value: this.parseExpr() });
          if (this.eat(';')) continue;
          throw new ConvertError(
            'A `( ... )` block must end with a result expression after its `$var := ...` bindings.',
          );
        }
        if (this.at(';')) {
          throw new ConvertError(
            'Only `$var := ...` statements are supported before the final expression in a `( ... )` block.',
          );
        }
        result = e;
        break;
      }
      this.expect(')');
      if (bindings.length === 0) return result;
      return { kind: 'block', bindings, result };
    }
    // `%` in operand position is JSONata's parent operator (distinct from the
    // infix `%` modulo, which parseBinary consumes between two operands).
    if (this.at('%')) {
      this.next();
      return { kind: 'parent', depth: 1 };
    }
    if (this.at('{')) return this.parseObject();
    if (this.at('[')) {
      this.next();
      const items: JNode[] = [];
      while (!this.at(']')) {
        items.push(this.parseExpr());
        if (!this.eat(',')) break;
      }
      this.expect(']');
      return { kind: 'array', items };
    }
    throw new ConvertError(
      `Unsupported JSONata construct near '${t.value || 'end of input'}'.`,
    );
  }

  private parseArgument(): JNode {
    if (this.peek().type === 'name' && this.peek().value === 'function') {
      return this.parseLambda();
    }
    return this.parseExpr();
  }

  private parseLambda(): JNode {
    this.expect('function');
    this.expect('(');
    const params: string[] = [];
    while (!this.at(')')) {
      const t = this.peek();
      if (t.type !== 'var') {
        throw new ConvertError('Lambda parameters must be $variables.');
      }
      this.next();
      params.push(t.value);
      if (!this.eat(',')) break;
    }
    this.expect(')');
    this.expect('{');
    const body = this.parseExpr();
    this.expect('}');
    return { kind: 'lambda', params, body };
  }
}

export function parseJsonata(source: string): JNode {
  return new JParser(lex(source)).parse();
}
