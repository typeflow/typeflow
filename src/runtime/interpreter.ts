/** Tree-walking interpreter over the compiled IR (the checked AST). */
import {
  type CompiledFn,
  type Expr,
  type ObjectExpr,
  parentChainDepth,
} from '../core';
import { BUILTINS } from '../builtins';
import { isNullish } from '../builtins/values';
import { TypeflowRuntimeError } from './errors';

const MAX_CALL_DEPTH = 128;

export interface Env {
  bindings?: Record<string, unknown>;
  element?: unknown;
  functions?: Record<string, (...args: unknown[]) => unknown>;
  /** Mapping-defined functions (`fn`), on the global env only. */
  defs?: Record<string, CompiledFn>;
  /** Shared call-depth counter, on the global env only. */
  depth?: { value: number };
  /** Input value, set on the root env; reachable from anywhere as `$root`. */
  rootInput?: unknown;
  parent?: Env;
}

/** Call a mapping-defined function: params only + globals — the input is not in scope. */
function callDef(
  def: CompiledFn,
  args: unknown[],
  globalEnv: Env,
  span: { start: number; end: number },
): unknown {
  const depth = (globalEnv.depth ??= { value: 0 });
  if (depth.value >= MAX_CALL_DEPTH) {
    throw new TypeflowRuntimeError(
      `Maximum call depth exceeded while evaluating '${def.name}'.`,
      span,
    );
  }
  depth.value++;
  try {
    const bindings: Record<string, unknown> = {};
    def.params.forEach((p, i) => {
      bindings[p] = args[i];
    });
    return evalExpr(def.body, { bindings, parent: globalEnv });
  } finally {
    depth.value--;
  }
}

/** The input value, set on the root env; `$root` reaches it through any nesting. */
function rootInput(env: Env): unknown {
  for (let e: Env | undefined = env; e; e = e.parent) {
    if ('rootInput' in e) return e.rootInput;
  }
  return undefined;
}

/**
 * The element `n` levels up (`$parent` = 1, `$parent.$parent` = 2, …), or the
 * input if the chain climbs past every enclosing element.
 */
function nthParentElement(env: Env, n: number): unknown {
  let count = 0;
  for (let e: Env | undefined = env; e; e = e.parent) {
    if (e.element !== undefined || 'element' in e) {
      count++;
      if (count === n + 1) return e.element;
    }
  }
  return rootInput(env);
}

function lookup(name: string, env: Env): unknown {
  if (name === '$root') return rootInput(env);
  if (name === '$parent') return nthParentElement(env, 1);
  for (let e: Env | undefined = env; e; e = e.parent) {
    if (e.element !== undefined || 'element' in e) {
      if (name === '$') return e.element;
      const el = e.element;
      if (
        el !== null &&
        typeof el === 'object' &&
        !Array.isArray(el) &&
        Object.hasOwn(el, name)
      ) {
        return (el as Record<string, unknown>)[name];
      }
    }
    if (e.bindings && Object.hasOwn(e.bindings, name)) return e.bindings[name];
  }
  return undefined;
}

function member(value: unknown, name: string): unknown {
  if (isNullish(value)) return undefined;
  if (Array.isArray(value)) {
    // Path access distributes over arrays, mirroring the checker's typing rule.
    return value.map((el) => member(el, name));
  }
  if (typeof value === 'object' && Object.hasOwn(value, name)) {
    return (value as Record<string, unknown>)[name];
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  return Boolean(v);
}

export function evalExpr(expr: Expr, env: Env): unknown {
  switch (expr.kind) {
    case 'lit':
      return expr.value;

    case 'ident':
      return lookup(expr.name, env);

    case 'member': {
      // `$parent.$parent…` climbs enclosing elements; a trailing `.field`
      // reads that ancestor's field.
      const depth = parentChainDepth(expr);
      if (depth !== null) return nthParentElement(env, depth);
      const objDepth = parentChainDepth(expr.object);
      const base =
        objDepth === null
          ? evalExpr(expr.object, env)
          : nthParentElement(env, objDepth);
      return member(base, expr.name);
    }

    case 'index': {
      const target = evalExpr(expr.object, env);
      if (!Array.isArray(target)) return undefined;
      const i = evalExpr(expr.index, { element: undefined, parent: env });
      if (typeof i !== 'number' || !Number.isInteger(i)) return undefined;
      return target[i];
    }

    case 'filter': {
      const target = evalExpr(expr.object, env);
      if (!Array.isArray(target)) return [];
      return target.filter((el) =>
        truthy(evalExpr(expr.predicate, { element: el, parent: env })),
      );
    }

    case 'sort': {
      const target = evalExpr(expr.object, env);
      if (!Array.isArray(target)) return [];
      // Stable order-by: `toSorted` is stable and non-mutating, so equal
      // elements keep their input order across the whole comparison.
      return target.toSorted((a, b) => {
        for (const term of expr.terms) {
          const ka = evalExpr(term.key, { element: a, parent: env });
          const kb = evalExpr(term.key, { element: b, parent: env });
          if (isNullish(ka) || isNullish(kb)) {
            if (isNullish(ka) && isNullish(kb)) continue;
            // Nullish keys sort last, regardless of direction.
            return isNullish(ka) ? 1 : -1;
          }
          const l = ka as number | string;
          const r = kb as number | string;
          if (l < r) return term.descending ? 1 : -1;
          if (l > r) return term.descending ? -1 : 1;
        }
        return 0;
      });
    }

    case 'bracket':
      throw new TypeflowRuntimeError(
        'Unresolved bracket expression: run the compiler before executing a mapping.',
        expr.span,
      );

    case 'project': {
      const target = evalExpr(expr.object, env);
      if (isNullish(target)) return undefined;
      // Optional `-> l { ... }` alias binds each element to `l` as well as `$`;
      // `-> l, i { ... }` also binds the 0-based position to `i`.
      const bindEnv = (el: unknown, index: number): Env => {
        const bindings: Record<string, unknown> = {};
        if (expr.binder) bindings[expr.binder] = el;
        if (expr.indexBinder) bindings[expr.indexBinder] = index;
        return { element: el, bindings, parent: env };
      };
      if (Array.isArray(target)) {
        return target.map((el, i) => evalObject(expr.body, bindEnv(el, i)));
      }
      return evalObject(expr.body, bindEnv(target, 0));
    }

    case 'unary': {
      const v = evalExpr(expr.operand, env);
      if (expr.op === '!') return !truthy(v);
      return typeof v === 'number' ? -v : undefined;
    }

    case 'binary':
      return evalBinary(expr, env);

    case 'cond':
      return truthy(evalExpr(expr.cond, env))
        ? evalExpr(expr.then, env)
        : evalExpr(expr.else, env);

    case 'call': {
      const args = expr.args.map((a) => evalExpr(a, env));
      for (let e: Env | undefined = env; e; e = e.parent) {
        const ext = e.functions?.[expr.name];
        if (ext) return ext(...args);
        const def = e.defs?.[expr.name];
        if (def) return callDef(def, args, e, expr.span);
      }
      const impl = BUILTINS[expr.name]?.impl;
      if (!impl)
        throw new TypeflowRuntimeError(
          `Unknown function '${expr.name}'.`,
          expr.nameSpan,
        );
      return impl(args);
    }

    case 'object':
      return evalObject(expr, env);

    case 'array':
      return expr.elements.map((e) => evalExpr(e, env));
  }
}

function evalObject(node: ObjectExpr, env: Env): Record<string, unknown> {
  // `let` bindings: evaluate in declaration order into a child env so each
  // binding sees the earlier ones (and the enclosing element/input), then the
  // properties are evaluated with every binding in scope.
  let bodyEnv = env;
  if (node.lets && node.lets.length > 0) {
    const bindings: Record<string, unknown> = Object.create(null);
    bodyEnv = { bindings, parent: env };
    for (const binding of node.lets) {
      bindings[binding.name] = evalExpr(binding.value, bodyEnv);
    }
  }
  // Null prototype: output objects cannot collide with Object.prototype members.
  const out: Record<string, unknown> = Object.create(null);
  for (const prop of node.props) {
    out[prop.name] = evalExpr(prop.value, bodyEnv);
  }
  // Re-wrap so consumers get a plain object (JSON.stringify, spread, etc. behave normally).
  return { ...out };
}

function evalBinary(
  expr: Extract<Expr, { kind: 'binary' }>,
  env: Env,
): unknown {
  const op = expr.op;

  if (op === '??') {
    const left = evalExpr(expr.left, env);
    return left ?? evalExpr(expr.right, env);
  }
  if (op === '&&') {
    return (
      truthy(evalExpr(expr.left, env)) && truthy(evalExpr(expr.right, env))
    );
  }
  if (op === '||') {
    return (
      truthy(evalExpr(expr.left, env)) || truthy(evalExpr(expr.right, env))
    );
  }

  const left = evalExpr(expr.left, env);
  const right = evalExpr(expr.right, env);

  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (isNullish(left) || isNullish(right)) return false;
      const l = left as number | string;
      const r = right as number | string;
      if (op === '<') return l < r;
      if (op === '<=') return l <= r;
      if (op === '>') return l > r;
      return l >= r;
    }
    case '+': {
      if (isNullish(left) || isNullish(right)) return undefined;
      if (typeof left === 'string' || typeof right === 'string')
        return String(left) + String(right);
      if (typeof left === 'number' && typeof right === 'number')
        return left + right;
      return undefined;
    }
    case '-':
    case '*':
    case '/':
    case '%': {
      if (typeof left !== 'number' || typeof right !== 'number')
        return undefined;
      if (op === '-') return left - right;
      if (op === '*') return left * right;
      if (op === '%') return left % right;
      return left / right;
    }
  }
}
