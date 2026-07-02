/**
 * Typeflow AST. Plain JSON-serializable objects: the checked AST doubles as the
 * runtime IR (brackets are disambiguated into `index`/`filter` by the compiler).
 */

export interface Span {
  start: number;
  end: number;
}

export type Expr =
  | LiteralExpr
  | IdentExpr
  | MemberExpr
  | BracketExpr
  | IndexExpr
  | FilterExpr
  | ProjectExpr
  | UnaryExpr
  | BinaryExpr
  | CondExpr
  | CallExpr
  | ObjectExpr
  | ArrayExpr;

export interface LiteralExpr {
  kind: "lit";
  value: string | number | boolean | null;
  span: Span;
}

export interface IdentExpr {
  kind: "ident";
  name: string;
  span: Span;
}

export interface MemberExpr {
  kind: "member";
  object: Expr;
  name: string;
  optional: boolean;
  span: Span;
  nameSpan: Span;
}

/** `expr[inner]` before semantic analysis — the checker rewrites it to `index` or `filter`. */
export interface BracketExpr {
  kind: "bracket";
  object: Expr;
  inner: Expr;
  span: Span;
}

export interface IndexExpr {
  kind: "index";
  object: Expr;
  index: Expr;
  span: Span;
}

export interface FilterExpr {
  kind: "filter";
  object: Expr;
  predicate: Expr;
  span: Span;
}

/** `expr -> { ... }`: per-element projection over arrays, scoped projection over objects. */
export interface ProjectExpr {
  kind: "project";
  object: Expr;
  body: ObjectExpr;
  span: Span;
}

export interface UnaryExpr {
  kind: "unary";
  op: "!" | "-";
  operand: Expr;
  span: Span;
}

export type BinaryOp =
  | "+" | "-" | "*" | "/"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||" | "??";

export interface BinaryExpr {
  kind: "binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface CondExpr {
  kind: "cond";
  cond: Expr;
  then: Expr;
  else: Expr;
  span: Span;
}

export interface CallExpr {
  kind: "call";
  name: string;
  args: Expr[];
  span: Span;
  nameSpan: Span;
}

export interface ObjectProp {
  name: string;
  value: Expr;
  span: Span;
}

export interface ObjectExpr {
  kind: "object";
  props: ObjectProp[];
  span: Span;
}

export interface ArrayExpr {
  kind: "array";
  elements: Expr[];
  span: Span;
}

/** Inline type syntax inside a `.typeflow` file (structural declarations). */
export type TypeNode =
  | { kind: "prim"; name: "string" | "number" | "boolean" | "null" | "unknown"; span: Span }
  | { kind: "lit"; value: string | number | boolean; span: Span }
  | { kind: "array"; element: TypeNode; span: Span }
  | { kind: "object"; fields: TypeFieldNode[]; span: Span }
  | { kind: "union"; types: TypeNode[]; span: Span };

export interface TypeFieldNode {
  name: string;
  optional: boolean;
  type: TypeNode;
  span: Span;
}

export interface InputDecl {
  name: string;
  /** `input user: User from "./types"` — resolved by a schema adapter. */
  typeRef?: { typeName: string; from: string };
  /** `input user: { id: number, ... }` — declared inline. */
  inlineType?: TypeNode;
  span: Span;
}

export interface MappingFile {
  input?: InputDecl;
  map: ObjectExpr;
}

/** Compiled artifact consumed by the runtime. JSON-serializable. */
export interface CompiledMapping {
  version: 1;
  inputName: string;
  ir: ObjectExpr;
}
