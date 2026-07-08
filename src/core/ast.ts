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
  | SortExpr
  | ProjectExpr
  | UnaryExpr
  | BinaryExpr
  | CondExpr
  | CallExpr
  | ObjectExpr
  | ArrayExpr;

export interface LiteralExpr {
  kind: 'lit';
  value: string | number | boolean | null;
  span: Span;
}

/**
 * Static resolution of an identifier, annotated by the checker on the checked
 * AST (optional → artifact v1 stays backward-compatible; absent means the
 * runtime falls back to the dynamic scope walk).
 *
 * `hops` counts scope levels up from the identifier's own scope, and is valid
 * because the checker's scope chain mirrors the runtime's env chain 1:1
 * (root, filter/index/sort element scopes, `->` scopes, `let` blocks, `fn`
 * bodies). `var` reads a binding at that level; `field` reads a field of the
 * element at that level. `dyn` marks a resolution the checker could not pin
 * down (optional field, `any`/`union` element on the path, conflicting
 * resolutions across union-part re-checks, index scopes).
 */
export type IdentRes =
  | { kind: 'var'; hops: number }
  | { kind: 'field'; hops: number }
  | { kind: 'dyn' };

export interface IdentExpr {
  kind: 'ident';
  name: string;
  span: Span;
  /** Static resolution (see IdentRes); absent → dynamic lookup. */
  res?: IdentRes;
}

export interface MemberExpr {
  kind: 'member';
  object: Expr;
  name: string;
  optional: boolean;
  span: Span;
  nameSpan: Span;
}

/** `expr[inner]` before semantic analysis — the checker rewrites it to `index` or `filter`. */
export interface BracketExpr {
  kind: 'bracket';
  object: Expr;
  inner: Expr;
  span: Span;
}

export interface IndexExpr {
  kind: 'index';
  object: Expr;
  index: Expr;
  span: Span;
}

export interface FilterExpr {
  kind: 'filter';
  object: Expr;
  predicate: Expr;
  span: Span;
}

/** A single sort key of `expr ^(...)`, evaluated in element scope. */
export interface SortTerm {
  key: Expr;
  /** `>key` sorts descending; `<key` (or bare `key`) sorts ascending. */
  descending: boolean;
}

/**
 * `expr ^(>a, b)`: JSONata-style order-by over an array. Each term's key is
 * evaluated in element scope (bare identifiers resolve on the element, like a
 * `[filter]`), and elements are compared by each term in turn. The sort is
 * stable, so equal elements keep their input order.
 */
export interface SortExpr {
  kind: 'sort';
  object: Expr;
  terms: SortTerm[];
  span: Span;
}

/** `expr -> { ... }`: per-element projection over arrays, scoped projection over objects. */
export interface ProjectExpr {
  kind: 'project';
  object: Expr;
  /** Optional element alias: `expr -> l { ... }` binds each element to `l`. */
  binder?: string;
  /** Optional 0-based index binder: `expr -> l, i { ... }` binds the position to `i`. */
  indexBinder?: string;
  body: ObjectExpr;
  span: Span;
}

export interface UnaryExpr {
  kind: 'unary';
  op: '!' | '-';
  operand: Expr;
  span: Span;
}

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '%'
  | '/'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||'
  | '??';

export interface BinaryExpr {
  kind: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface CondExpr {
  kind: 'cond';
  cond: Expr;
  then: Expr;
  else: Expr;
  span: Span;
}

export interface CallExpr {
  kind: 'call';
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

/**
 * `let name = expr` — an immutable, block-scoped binding inside an object
 * block. Visible to the block's properties and to `let`s declared after it
 * (forward references are rejected, so bindings stay terminating). Bindings do
 * not appear in the output; they only name a subexpression for reuse.
 */
export interface LetBinding {
  name: string;
  value: Expr;
  span: Span;
  nameSpan: Span;
}

export interface ObjectExpr {
  kind: 'object';
  props: ObjectProp[];
  /** Block-scoped `let` bindings, in declaration order. */
  lets?: LetBinding[];
  span: Span;
}

export interface ArrayExpr {
  kind: 'array';
  elements: Expr[];
  span: Span;
}

/** Inline type syntax inside a `.typeflow` file (structural declarations). */
export type TypeNode =
  | {
      kind: 'prim';
      name: 'string' | 'number' | 'boolean' | 'null' | 'unknown';
      span: Span;
    }
  | { kind: 'lit'; value: string | number | boolean; span: Span }
  | { kind: 'array'; element: TypeNode; span: Span }
  | { kind: 'object'; fields: TypeFieldNode[]; span: Span }
  | { kind: 'union'; types: TypeNode[]; span: Span };

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

export interface UseParam {
  name: string;
  optional: boolean;
  type: TypeNode;
  span: Span;
}

/** `use slugify(value: string): string from "./helpers"` — a typed external function. */
export interface UseDecl {
  name: string;
  params: UseParam[];
  returnType: TypeNode;
  from: string;
  span: Span;
  nameSpan: Span;
}

/**
 * `fn fullName(first: string, last: string): string = first + " " + last`
 * A pure function defined in the mapping language itself: the body is a
 * Typeflow expression over the parameters (the input binding is not in
 * scope). The return type is optional — inferred from the body when omitted.
 */
export interface FnDecl {
  name: string;
  params: UseParam[];
  returnType?: TypeNode;
  body: Expr;
  span: Span;
  nameSpan: Span;
}

/**
 * If `expr` is a `$parent` chain (`$parent`, `$parent.$parent`, …), returns how
 * many enclosing element levels it climbs; otherwise `null`. A trailing field
 * access (`$parent.$parent.field`) is NOT a chain — its `.object` is.
 */
export function parentChainDepth(expr: Expr): number | null {
  if (expr.kind === 'ident' && expr.name === '$parent') return 1;
  if (expr.kind === 'member' && expr.name === '$parent') {
    const inner = parentChainDepth(expr.object);
    return inner === null ? null : inner + 1;
  }
  return null;
}

export interface MappingFile {
  input?: InputDecl;
  uses?: UseDecl[];
  fns?: FnDecl[];
  map: ObjectExpr;
}

/**
 * An external function the compiled mapping depends on. `from` is present for
 * `use` declarations (module to import); absent for functions registered
 * programmatically via `defineFunction` + `compile(src, { functions })`.
 */
export interface ExternalFunction {
  name: string;
  from?: string;
}

/** A mapping-defined function (`fn`), carried in the compiled artifact. */
export interface CompiledFn {
  name: string;
  params: string[];
  body: Expr;
}

/** Compiled artifact consumed by the runtime. JSON-serializable. */
export interface CompiledMapping {
  version: 1;
  inputName: string;
  /** External functions the mapping calls; the runtime requires implementations for these. */
  functions?: ExternalFunction[];
  /** Functions defined in the mapping itself (`fn name(...) = expr`). */
  defs?: CompiledFn[];
  ir: ObjectExpr;
}
