/**
 * Programmatic custom functions: declared like builtins (typed signature +
 * implementation + doc), registered per compilation via
 * `compile(src, { functions: [myFn] })` and per runtime via
 * `createMapping(compiled, { functions: [myFn] })`.
 */
import {
  type Expr,
  type Type,
  type TypeNode,
  typeSatisfies,
  typeToString,
  type UseParam,
} from '#core';
import { type Builtin } from '#builtins';
import { parseFunctionSignature } from '#parser';
import { typeFromNode } from './type-nodes';

export interface TypeflowFunction {
  name: string;
  /** Canonical rendered signature, e.g. `slugify(value: string): string`. */
  signature: string;
  doc?: string;
  impl: (...args: unknown[]) => unknown;
  /** Parsed declaration, consumed by the checker. */
  params: UseParam[];
  returnType: TypeNode;
}

export interface DefineFunctionOptions {
  doc?: string;
  impl: (...args: unknown[]) => unknown;
}

/**
 * Declare a custom function from a Typeflow signature string:
 *
 *   const slugify = defineFunction('slugify(value: string): string', {
 *     doc: 'Lowercase, dash-separated slug.',
 *     impl: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
 *   });
 *
 * Calls are type-checked at compile time exactly like builtins and `use`
 * declarations. Throws on an invalid signature.
 */
export function defineFunction(
  signature: string,
  options: DefineFunctionOptions,
): TypeflowFunction {
  const { signature: parsed, diagnostics } = parseFunctionSignature(signature);
  if (!parsed) {
    const detail = diagnostics[0]?.message ?? 'could not parse the signature';
    throw new Error(`Invalid function signature '${signature}': ${detail}`);
  }
  return {
    name: parsed.name,
    signature: renderSignature(parsed.name, parsed.params, parsed.returnType),
    doc: options.doc,
    impl: options.impl,
    params: parsed.params,
    returnType: parsed.returnType,
  };
}

/** Canonical `name(param: Type, ...): Type` rendering of a parsed signature. */
export function renderSignature(
  name: string,
  params: UseParam[],
  returnType: TypeNode,
): string {
  return renderSignatureFromType(name, params, typeFromNode(returnType));
}

function renderSignatureFromType(
  name: string,
  params: UseParam[],
  result: Type,
): string {
  const rendered = params
    .map(
      (p) =>
        `${p.name}${p.optional ? '?' : ''}: ${typeToString(typeFromNode(p.type))}`,
    )
    .join(', ');
  return `${name}(${rendered}): ${typeToString(result)}`;
}

/** Build a checkable function-table entry from parsed params and a result type. */
export function builtinFrom(
  name: string,
  params: UseParam[],
  result: Type,
): Builtin {
  const paramTypes = params.map((p) => typeFromNode(p.type));
  return {
    params: params.map((p, i) => ({
      label: typeToString(paramTypes[i]!),
      check: (t: Type) => typeSatisfies(t, paramTypes[i]!),
      optional: p.optional,
    })),
    result,
    signature: renderSignatureFromType(name, params, result),
  };
}

/** Turn a parsed signature into a checkable function-table entry. */
export function signatureToBuiltin(
  name: string,
  params: UseParam[],
  returnType: TypeNode,
): Builtin {
  return builtinFrom(name, params, typeFromNode(returnType));
}

/** Collect the names of every function called anywhere in an expression tree. */
export function collectCallNames(expr: Expr, out: Set<string>): void {
  switch (expr.kind) {
    case 'call':
      out.add(expr.name);
      for (const a of expr.args) collectCallNames(a, out);
      return;
    case 'member':
      return collectCallNames(expr.object, out);
    case 'bracket':
      collectCallNames(expr.object, out);
      return collectCallNames(expr.inner, out);
    case 'index':
      collectCallNames(expr.object, out);
      return collectCallNames(expr.index, out);
    case 'filter':
      collectCallNames(expr.object, out);
      return collectCallNames(expr.predicate, out);
    case 'project':
      collectCallNames(expr.object, out);
      return collectCallNames(expr.body, out);
    case 'sort':
      collectCallNames(expr.object, out);
      for (const t of expr.terms) collectCallNames(t.key, out);
      return;
    case 'unary':
      return collectCallNames(expr.operand, out);
    case 'binary':
      collectCallNames(expr.left, out);
      return collectCallNames(expr.right, out);
    case 'cond':
      collectCallNames(expr.cond, out);
      collectCallNames(expr.then, out);
      return collectCallNames(expr.else, out);
    case 'object':
      for (const l of expr.lets ?? []) collectCallNames(l.value, out);
      for (const p of expr.props) collectCallNames(p.value, out);
      return;
    case 'array':
      for (const e of expr.elements) collectCallNames(e, out);
      return;
    case 'lit':
    case 'ident':
      return;
  }
}
