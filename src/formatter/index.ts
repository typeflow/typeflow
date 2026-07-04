import {
  type Diagnostic,
  type Expr,
  type MappingFile,
  type ObjectExpr,
  type Span,
  type TypeNode,
} from '../core';
import { parse, type Token, tokenize } from '../parser';

export interface FormatResult {
  ok: boolean;
  formatted: string;
  diagnostics: Diagnostic[];
}

const INLINE_LIMIT = 70;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Format a `.typeflow` source into its canonical form. Unparseable input is returned unchanged. */
export function format(source: string): FormatResult {
  const { ast, diagnostics } = parse(source);
  if (!ast) return { ok: false, formatted: source, diagnostics };
  const formatted = new Printer(source, ast).print();
  return { ok: true, formatted, diagnostics };
}

// Binary operator precedence; higher binds tighter. Mirrors the parser's levels.
const BINARY_PREC: Record<string, number> = {
  '??': 2,
  '||': 3,
  '&&': 4,
  '==': 5,
  '!=': 5,
  '<': 6,
  '<=': 6,
  '>': 6,
  '>=': 6,
  '+': 7,
  '-': 7,
  '*': 8,
  '/': 8,
  '%': 8,
};

function precOf(e: Expr): number {
  switch (e.kind) {
    case 'cond':
      return 1;
    case 'binary':
      return BINARY_PREC[e.op]!;
    case 'unary':
      return 9;
    case 'member':
    case 'bracket':
    case 'index':
    case 'filter':
    case 'sort':
    case 'project':
      return 10;
    default:
      return 11;
  }
}

function propName(name: string): string {
  return IDENT_RE.test(name) ? name : JSON.stringify(name);
}

class Printer {
  private comments: Token[];
  private nextComment = 0;

  constructor(
    private source: string,
    private ast: MappingFile,
  ) {
    this.comments = tokenize(source, {
      includeComments: true,
      tolerant: true,
    }).filter((t) => t.type === 'comment');
  }

  print(): string {
    const lines: string[] = [];
    let prevEnd = 0;

    if (this.ast.input) {
      prevEnd = this.emitComments(
        lines,
        this.ast.input.span.start,
        prevEnd,
        '',
      );
      const input = this.ast.input;
      const rhs = input.typeRef
        ? `${input.typeRef.typeName} from ${JSON.stringify(input.typeRef.from)}`
        : this.printType(input.inlineType!, 0);
      lines.push(`input ${input.name}: ${rhs}`);
      prevEnd = input.span.end;
    }

    if (this.ast.uses?.length) {
      if (this.ast.input) lines.push('');
      for (const u of this.ast.uses) {
        prevEnd = this.emitComments(lines, u.span.start, prevEnd, '');
        lines.push(
          `use ${u.name}(${this.printParams(u.params)}): ${this.printType(u.returnType, 0)} from ${JSON.stringify(u.from)}`,
        );
        prevEnd = u.span.end;
      }
    }

    if (this.ast.fns?.length) {
      if (this.ast.input || this.ast.uses?.length) lines.push('');
      for (const f of this.ast.fns) {
        prevEnd = this.emitComments(lines, f.span.start, prevEnd, '');
        const ret = f.returnType ? `: ${this.printType(f.returnType, 0)}` : '';
        lines.push(
          `fn ${f.name}(${this.printParams(f.params)})${ret} = ${this.printExpr(f.body, 1, 0)}`,
        );
        prevEnd = f.span.end;
      }
    }

    if (this.ast.input || this.ast.uses?.length || this.ast.fns?.length)
      lines.push('');

    prevEnd = this.emitComments(lines, this.ast.map.span.start, prevEnd, '');
    lines.push(`map ${this.printObject(this.ast.map, 0, true)}`);
    prevEnd = this.ast.map.span.end;

    this.emitComments(lines, this.source.length, prevEnd, '');

    return collapseBlanks(lines).join('\n') + '\n';
  }

  // ---- comments & layout ----

  private hasBlankBetween(from: number, to: number): boolean {
    return /\n[ \t]*\r?\n/.test(this.source.slice(from, to));
  }

  /** Emit pending comments that appear before `offset`; returns the new "previous end" position. */
  private emitComments(
    lines: string[],
    offset: number,
    prevEnd: number,
    pad: string,
  ): number {
    while (
      this.nextComment < this.comments.length &&
      this.comments[this.nextComment]!.start < offset
    ) {
      const c = this.comments[this.nextComment++]!;
      if (this.hasBlankBetween(prevEnd, c.start)) lines.push('');
      lines.push(pad + c.value.trimEnd());
      prevEnd = c.end;
    }
    return prevEnd;
  }

  private hasCommentWithin(start: number, end: number): boolean {
    for (let i = this.nextComment; i < this.comments.length; i++) {
      const c = this.comments[i]!;
      if (c.start >= end) return false;
      if (c.start > start) return true;
    }
    return false;
  }

  // ---- expressions ----

  private printParams(params: import('../core').UseParam[]): string {
    return params
      .map(
        (p) =>
          `${p.name}${p.optional ? '?' : ''}: ${this.printType(p.type, 0)}`,
      )
      .join(', ');
  }

  private printObject(
    obj: ObjectExpr,
    indent: number,
    forceMultiline = false,
  ): string {
    // Merge `let` bindings and properties back into source order so the printed
    // block preserves the author's interleaving (and comment placement).
    const members: { span: Span; text: (i: number) => string }[] = [
      ...(obj.lets ?? []).map((l) => ({
        span: l.span,
        text: (i: number) => `let ${l.name} = ${this.printExpr(l.value, 1, i)}`,
      })),
      ...obj.props.map((p) => ({
        span: p.span,
        text: (i: number) =>
          `${propName(p.name)}: ${this.printExpr(p.value, 1, i)}`,
      })),
    ].toSorted((a, b) => a.span.start - b.span.start);

    if (members.length === 0) return '{}';

    if (
      !forceMultiline &&
      !this.hasCommentWithin(obj.span.start, obj.span.end)
    ) {
      const inline = `{ ${members.map((m) => m.text(indent)).join(', ')} }`;
      if (!inline.includes('\n') && indent + inline.length <= INLINE_LIMIT)
        return inline;
    }

    const pad = ' '.repeat(indent + 2);
    const lines: string[] = ['{'];
    let prevEnd = obj.span.start + 1;
    for (const member of members) {
      const before = lines.length;
      prevEnd = this.emitComments(lines, member.span.start, prevEnd, pad);
      if (
        lines.length === before &&
        this.hasBlankBetween(prevEnd, member.span.start)
      )
        lines.push('');
      lines.push(`${pad}${member.text(indent + 2)},`);
      prevEnd = member.span.end;
    }
    prevEnd = this.emitComments(lines, obj.span.end, prevEnd, pad);
    lines.push(' '.repeat(indent) + '}');
    return lines.join('\n');
  }

  private printExpr(e: Expr, minPrec: number, indent: number): string {
    const text = this.printExprInner(e, indent);
    return precOf(e) < minPrec ? `(${text})` : text;
  }

  private printExprInner(e: Expr, indent: number): string {
    switch (e.kind) {
      case 'lit':
        if (e.value === null) return 'null';
        if (typeof e.value === 'string') return JSON.stringify(e.value);
        return String(e.value);
      case 'ident':
        return e.name;
      case 'member':
        return `${this.printExpr(e.object, 10, indent)}${e.optional ? '?.' : '.'}${e.name}`;
      case 'bracket':
        return `${this.printExpr(e.object, 10, indent)}[${this.printExpr(e.inner, 1, indent)}]`;
      case 'index':
        return `${this.printExpr(e.object, 10, indent)}[${this.printExpr(e.index, 1, indent)}]`;
      case 'filter':
        return `${this.printExpr(e.object, 10, indent)}[${this.printExpr(e.predicate, 1, indent)}]`;
      case 'sort': {
        const terms = e.terms
          .map(
            (t) =>
              `${t.descending ? '>' : ''}${this.printExpr(t.key, 1, indent)}`,
          )
          .join(', ');
        return `${this.printExpr(e.object, 10, indent)} ^(${terms})`;
      }
      case 'project': {
        const binders = e.binder
          ? `${e.binder}${e.indexBinder ? `, ${e.indexBinder}` : ''} `
          : '';
        return `${this.printExpr(e.object, 10, indent)} -> ${binders}${this.printObject(e.body, indent)}`;
      }
      case 'unary': {
        const operand = this.printExpr(e.operand, 9, indent);
        // Avoid `--x` fusing into an invalid token sequence visually.
        const sep = e.op === '-' && operand.startsWith('-') ? ' ' : '';
        return `${e.op}${sep}${operand}`;
      }
      case 'binary': {
        const prec = BINARY_PREC[e.op]!;
        return `${this.printExpr(e.left, prec, indent)} ${e.op} ${this.printExpr(e.right, prec + 1, indent)}`;
      }
      case 'cond':
        return `${this.printExpr(e.cond, 2, indent)} ? ${this.printExpr(e.then, 1, indent)} : ${this.printExpr(e.else, 1, indent)}`;
      case 'call':
        return `${e.name}(${e.args.map((a) => this.printExpr(a, 1, indent)).join(', ')})`;
      case 'object':
        return this.printObject(e, indent);
      case 'array': {
        const parts = e.elements.map((el) => this.printExpr(el, 1, indent + 2));
        const inline = `[${parts.join(', ')}]`;
        if (!inline.includes('\n') && indent + inline.length <= INLINE_LIMIT)
          return inline;
        const pad = ' '.repeat(indent + 2);
        return `[\n${parts.map((p) => pad + p + ',').join('\n')}\n${' '.repeat(indent)}]`;
      }
    }
  }

  // ---- inline types ----

  private printType(node: TypeNode, indent: number): string {
    switch (node.kind) {
      case 'prim':
        return node.name;
      case 'lit':
        return JSON.stringify(node.value);
      case 'array': {
        const el = this.printType(node.element, indent);
        return node.element.kind === 'union' ? `(${el})[]` : `${el}[]`;
      }
      case 'union':
        return node.types.map((t) => this.printType(t, indent)).join(' | ');
      case 'object': {
        if (node.fields.length === 0) return '{}';
        const parts = node.fields.map(
          (f) =>
            `${propName(f.name)}${f.optional ? '?' : ''}: ${this.printType(f.type, indent)}`,
        );
        const inline = `{ ${parts.join(', ')} }`;
        if (
          !inline.includes('\n') &&
          indent + inline.length <= INLINE_LIMIT &&
          !this.hasCommentWithin(node.span.start, node.span.end)
        ) {
          return inline;
        }
        const pad = ' '.repeat(indent + 2);
        const lines: string[] = ['{'];
        let prevEnd = node.span.start + 1;
        for (const field of node.fields) {
          prevEnd = this.emitComments(lines, field.span.start, prevEnd, pad);
          lines.push(
            `${pad}${propName(field.name)}${field.optional ? '?' : ''}: ${this.printType(field.type, indent + 2)},`,
          );
          prevEnd = field.span.end;
        }
        prevEnd = this.emitComments(lines, node.span.end, prevEnd, pad);
        lines.push(' '.repeat(indent) + '}');
        return lines.join('\n');
      }
    }
  }
}

/** Collapse runs of blank lines to one and trim leading/trailing blanks. */
function collapseBlanks(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === ''))
      continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}
