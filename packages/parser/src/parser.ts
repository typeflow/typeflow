import type {
  ArrayExpr,
  Diagnostic,
  Expr,
  InputDecl,
  MappingFile,
  ObjectExpr,
  ObjectProp,
  Span,
  TypeFieldNode,
  TypeNode,
} from "@thomasfarineau/typeflow-core";
import { LexError, tokenize, type Token } from "./lexer.ts";

export interface ParseResult {
  ast: MappingFile | null;
  diagnostics: Diagnostic[];
}

class ParseError extends Error {
  constructor(public diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

const PRIM_NAMES = new Set(["string", "number", "boolean", "null", "unknown"]);

export function parse(source: string): ParseResult {
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (e) {
    if (e instanceof LexError) return { ast: null, diagnostics: [e.diagnostic] };
    throw e;
  }
  try {
    const ast = new Parser(tokens).parseFile();
    return { ast, diagnostics: [] };
  } catch (e) {
    if (e instanceof ParseError) return { ast: null, diagnostics: [e.diagnostic] };
    throw e;
  }
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== "eof") this.pos++;
    return t;
  }

  private at(type: "punct" | "ident", value: string): boolean {
    const t = this.peek();
    return t.type === type && t.value === value;
  }

  private eat(type: "punct" | "ident", value: string): boolean {
    if (this.at(type, value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectPunct(value: string): Token {
    if (!this.at("punct", value)) this.fail(`Expected '${value}'.`);
    return this.next();
  }

  private expectIdent(): Token {
    const t = this.peek();
    if (t.type !== "ident") this.fail("Expected an identifier.");
    return this.next();
  }

  private fail(message: string, span?: Span): never {
    const t = this.peek();
    throw new ParseError({
      code: "TF1002",
      message: t.type === "eof" ? `${message} Unexpected end of file.` : message,
      span: span ?? { start: t.start, end: t.end },
      severity: "error",
    });
  }

  parseFile(): MappingFile {
    let input: InputDecl | undefined;
    while (this.at("ident", "input")) {
      if (input) this.fail("Only one 'input' declaration is allowed in v0.1.");
      input = this.parseInputDecl();
    }
    if (!this.at("ident", "map")) {
      this.fail("Expected a 'map { ... }' block.");
    }
    this.next(); // map
    const map = this.parseObjectExpr();
    if (this.peek().type !== "eof") {
      this.fail("Unexpected content after the 'map' block.");
    }
    return { input, map };
  }

  private parseInputDecl(): InputDecl {
    const kw = this.next(); // input
    const nameTok = this.expectIdent();
    this.expectPunct(":");

    // `input user: User from "./types"` — a bare capitalized identifier followed by `from`
    // is a type reference resolved by a schema adapter.
    if (this.peek().type === "ident" && !PRIM_NAMES.has(this.peek().value) && this.peek(1).type === "ident" && this.peek(1).value === "from") {
      const typeName = this.next().value;
      this.next(); // from
      const fromTok = this.peek();
      if (fromTok.type !== "string") this.fail("Expected a module path string after 'from'.");
      this.next();
      return {
        name: nameTok.value,
        typeRef: { typeName, from: fromTok.value },
        span: { start: kw.start, end: fromTok.end },
      };
    }

    const inlineType = this.parseTypeExpr();
    return {
      name: nameTok.value,
      inlineType,
      span: { start: kw.start, end: inlineType.span.end },
    };
  }

  // ---- Inline type syntax ----

  private parseTypeExpr(): TypeNode {
    const first = this.parsePostfixType();
    if (!this.at("punct", "|")) return first;
    const types = [first];
    while (this.eat("punct", "|")) types.push(this.parsePostfixType());
    return { kind: "union", types, span: { start: first.span.start, end: types[types.length - 1]!.span.end } };
  }

  private parsePostfixType(): TypeNode {
    let t = this.parsePrimaryType();
    while (this.at("punct", "[") && this.peek(1).type === "punct" && this.peek(1).value === "]") {
      this.next();
      const close = this.next();
      t = { kind: "array", element: t, span: { start: t.span.start, end: close.end } };
    }
    return t;
  }

  private parsePrimaryType(): TypeNode {
    const t = this.peek();
    if (t.type === "ident") {
      if (PRIM_NAMES.has(t.value)) {
        this.next();
        return { kind: "prim", name: t.value as never, span: { start: t.start, end: t.end } };
      }
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { kind: "lit", value: t.value === "true", span: { start: t.start, end: t.end } };
      }
      this.fail(`Unknown type '${t.value}'. Inline types support: string, number, boolean, null, unknown, literals, arrays, objects, and unions.`);
    }
    if (t.type === "string") {
      this.next();
      return { kind: "lit", value: t.value, span: { start: t.start, end: t.end } };
    }
    if (t.type === "number") {
      this.next();
      return { kind: "lit", value: Number(t.value), span: { start: t.start, end: t.end } };
    }
    if (this.at("punct", "(")) {
      this.next();
      const inner = this.parseTypeExpr();
      this.expectPunct(")");
      return inner;
    }
    if (this.at("punct", "{")) {
      const open = this.next();
      const fields: TypeFieldNode[] = [];
      while (!this.at("punct", "}")) {
        const nameTok = this.peek();
        let name: string;
        if (nameTok.type === "ident") name = this.next().value;
        else if (nameTok.type === "string") name = this.next().value;
        else this.fail("Expected a field name.");
        const optional = this.eat("punct", "?");
        this.expectPunct(":");
        const type = this.parseTypeExpr();
        fields.push({ name: name!, optional, type, span: { start: nameTok.start, end: type.span.end } });
        if (!this.eat("punct", ",")) break;
      }
      const close = this.expectPunct("}");
      return { kind: "object", fields, span: { start: open.start, end: close.end } };
    }
    this.fail("Expected a type.");
  }

  // ---- Expressions ----

  private parseObjectExpr(): ObjectExpr {
    const open = this.expectPunct("{");
    const props: ObjectProp[] = [];
    while (!this.at("punct", "}")) {
      const nameTok = this.peek();
      let name: string;
      if (nameTok.type === "ident") name = this.next().value;
      else if (nameTok.type === "string") name = this.next().value;
      else this.fail("Expected a property name.");
      this.expectPunct(":");
      const value = this.parseExpr();
      props.push({ name: name!, value, span: { start: nameTok.start, end: value.span.end } });
      if (!this.eat("punct", ",")) break;
    }
    const close = this.expectPunct("}");
    return { kind: "object", props, span: { start: open.start, end: close.end } };
  }

  parseExpr(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const cond = this.parseNullish();
    if (!this.eat("punct", "?")) return cond;
    const then = this.parseExpr();
    this.expectPunct(":");
    const els = this.parseExpr();
    return { kind: "cond", cond, then, else: els, span: { start: cond.span.start, end: els.span.end } };
  }

  private parseBinaryLevel(ops: string[], nextLevel: () => Expr): Expr {
    let left = nextLevel.call(this);
    while (this.peek().type === "punct" && ops.includes(this.peek().value)) {
      const op = this.next().value as never;
      const right = nextLevel.call(this);
      left = { kind: "binary", op, left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  private parseNullish(): Expr {
    return this.parseBinaryLevel(["??"], this.parseOr);
  }

  private parseOr(): Expr {
    return this.parseBinaryLevel(["||"], this.parseAnd);
  }

  private parseAnd(): Expr {
    return this.parseBinaryLevel(["&&"], this.parseEquality);
  }

  private parseEquality(): Expr {
    return this.parseBinaryLevel(["==", "!="], this.parseRelational);
  }

  private parseRelational(): Expr {
    return this.parseBinaryLevel(["<", "<=", ">", ">="], this.parseAdditive);
  }

  private parseAdditive(): Expr {
    return this.parseBinaryLevel(["+", "-"], this.parseMultiplicative);
  }

  private parseMultiplicative(): Expr {
    return this.parseBinaryLevel(["*", "/"], this.parseUnary);
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (this.at("punct", "!") || this.at("punct", "-")) {
      this.next();
      const operand = this.parseUnary();
      return { kind: "unary", op: t.value as "!" | "-", operand, span: { start: t.start, end: operand.span.end } };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at("punct", ".") || this.at("punct", "?.")) {
        const optional = this.peek().value === "?.";
        this.next();
        const nameTok = this.expectIdent();
        expr = {
          kind: "member",
          object: expr,
          name: nameTok.value,
          optional,
          span: { start: expr.span.start, end: nameTok.end },
          nameSpan: { start: nameTok.start, end: nameTok.end },
        };
      } else if (this.at("punct", "[")) {
        this.next();
        const inner = this.parseExpr();
        const close = this.expectPunct("]");
        expr = { kind: "bracket", object: expr, inner, span: { start: expr.span.start, end: close.end } };
      } else if (this.at("punct", "->")) {
        this.next();
        const body = this.parseObjectExpr();
        expr = { kind: "project", object: expr, body, span: { start: expr.span.start, end: body.span.end } };
      } else {
        return expr;
      }
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.type === "number") {
      this.next();
      return { kind: "lit", value: Number(t.value), span: { start: t.start, end: t.end } };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "lit", value: t.value, span: { start: t.start, end: t.end } };
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { kind: "lit", value: t.value === "true", span: { start: t.start, end: t.end } };
      }
      if (t.value === "null") {
        this.next();
        return { kind: "lit", value: null, span: { start: t.start, end: t.end } };
      }
      this.next();
      // Function call: `name(args)`
      if (this.at("punct", "(")) {
        this.next();
        const args: Expr[] = [];
        while (!this.at("punct", ")")) {
          args.push(this.parseExpr());
          if (!this.eat("punct", ",")) break;
        }
        const close = this.expectPunct(")");
        return {
          kind: "call",
          name: t.value,
          args,
          span: { start: t.start, end: close.end },
          nameSpan: { start: t.start, end: t.end },
        };
      }
      return { kind: "ident", name: t.value, span: { start: t.start, end: t.end } };
    }
    if (this.at("punct", "(")) {
      this.next();
      const inner = this.parseExpr();
      const close = this.expectPunct(")");
      inner.span = { start: t.start, end: close.end };
      return inner;
    }
    if (this.at("punct", "{")) {
      return this.parseObjectExpr();
    }
    if (this.at("punct", "[")) {
      this.next();
      const elements: Expr[] = [];
      while (!this.at("punct", "]")) {
        elements.push(this.parseExpr());
        if (!this.eat("punct", ",")) break;
      }
      const close = this.expectPunct("]");
      return { kind: "array", elements, span: { start: t.start, end: close.end } } as ArrayExpr;
    }
    this.fail("Expected an expression.");
  }
}
