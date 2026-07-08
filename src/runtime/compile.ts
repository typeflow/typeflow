/**
 * Closure-compiling runtime: the IR is walked ONCE at preparation and turned
 * into nested closures — per-node dispatch, `$parent` chain depths, binder
 * presence, call targets and the dangerous-key decision in object literals
 * are all resolved here; execution is direct calls. No `eval` / `new
 * Function`, so strict CSP and the sandbox argument hold unchanged.
 *
 * Semantics are identical to the tree-walking interpreter
 * (./interpreter.ts, kept as the reference implementation); the equivalence
 * is asserted by tests. Identifier lookup stays dynamic — resolving it
 * statically from checker knowledge is the next planned step
 * (explore/optimisation-runtime.md, marche 2).
 */
import {
  type CompiledFn,
  type CompiledMapping,
  type Expr,
  type ObjectExpr,
  parentChainDepth,
} from '../core';
import { BUILTINS } from '../builtins';
import { isNullish } from '../builtins/values';
import { TypeflowRuntimeError } from './errors';

const MAX_CALL_DEPTH = 128;

interface Env {
  bindings?: Record<string, unknown>;
  element?: unknown;
  parent?: Env;
}

type Op = (env: Env) => unknown;

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

/** Compile a checked artifact into an executable function. Called by createMapping. */
export function compileMapping(
  compiled: CompiledMapping,
  external: Record<string, (...args: unknown[]) => unknown>,
): (input: unknown) => unknown {
  const defs = new Map<string, CompiledFn>(
    (compiled.defs ?? []).map((d) => [d.name, d]),
  );
  // Per-run state, shared by the compiled closures. Execution is synchronous,
  // so save/restore in the entry function keeps re-entrant calls (an external
  // function invoking the same mapping) correct.
  const state = { input: undefined as unknown, depth: 0 };
  // Def bodies are compiled once, lazily (a def may call another def).
  const compiledDefs = new Map<string, Op>();

  function defBody(def: CompiledFn): Op {
    let op = compiledDefs.get(def.name);
    if (!op) {
      op = compileExpr(def.body);
      compiledDefs.set(def.name, op);
    }
    return op;
  }

  /** Element `n` levels up, or the input past every enclosing element. */
  function nthParentElement(env: Env, n: number): unknown {
    let count = 0;
    for (let e: Env | undefined = env; e; e = e.parent) {
      if (e.element !== undefined || 'element' in e) {
        count++;
        if (count === n + 1) return e.element;
      }
    }
    return state.input;
  }

  function lookup(name: string, env: Env): unknown {
    for (let e: Env | undefined = env; e; e = e.parent) {
      if (e.element !== undefined || 'element' in e) {
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
      if (e.bindings && Object.hasOwn(e.bindings, name))
        return e.bindings[name];
    }
    return undefined;
  }

  function compileObject(node: ObjectExpr): Op {
    const lets = (node.lets ?? []).map(
      (l) => [l.name, compileExpr(l.value)] as const,
    );
    const props = node.props.map(
      (p) => [p.name, compileExpr(p.value)] as const,
    );
    // `__proto__` as an own key needs the null-proto + spread dance (spread
    // creates it as a data property); any other key writes straight into a
    // plain object. Decided here, once per object literal.
    const dangerous = props.some(([name]) => name === '__proto__');

    return (env) => {
      let bodyEnv = env;
      if (lets.length > 0) {
        const bindings: Record<string, unknown> = Object.create(null);
        bodyEnv = { bindings, parent: env };
        for (const [name, op] of lets) bindings[name] = op(bodyEnv);
      }
      if (dangerous) {
        const out: Record<string, unknown> = Object.create(null);
        for (const [name, op] of props) out[name] = op(bodyEnv);
        return { ...out };
      }
      const out: Record<string, unknown> = {};
      for (const [name, op] of props) out[name] = op(bodyEnv);
      return out;
    };
  }

  function compileExpr(expr: Expr): Op {
    switch (expr.kind) {
      case 'lit': {
        const v = expr.value;
        return () => v;
      }

      case 'ident': {
        const name = expr.name;
        if (name === '$root') return () => state.input;
        if (name === '$parent') return (env) => nthParentElement(env, 1);
        if (name === '$') {
          // Nearest enclosing element — unlike `$parent`, no input fallback.
          return (env) => {
            for (let e: Env | undefined = env; e; e = e.parent) {
              if (e.element !== undefined || 'element' in e) return e.element;
            }
            return undefined;
          };
        }
        // Static resolution (annotated by the checker): read the binding or
        // element field directly at a known depth instead of walking the
        // chain with hasOwn at every level.
        const res = expr.res;
        if (res?.kind === 'var') {
          const hops = res.hops;
          if (hops === 0) return (env) => env.bindings?.[name];
          return (env) => {
            let e: Env | undefined = env;
            for (let i = 0; i < hops && e; i++) e = e.parent;
            return e?.bindings?.[name];
          };
        }
        if (res?.kind === 'field') {
          const hops = res.hops;
          return (env) => {
            let e: Env | undefined = env;
            for (let i = 0; i < hops && e; i++) e = e.parent;
            const el = e?.element;
            // Same guards as the dynamic lookup: own properties of plain
            // objects only (no prototype reads, no array distribution).
            return el !== null &&
              typeof el === 'object' &&
              !Array.isArray(el) &&
              Object.hasOwn(el, name)
              ? (el as Record<string, unknown>)[name]
              : undefined;
          };
        }
        return (env) => lookup(name, env);
      }

      case 'member': {
        const depth = parentChainDepth(expr);
        if (depth !== null) return (env) => nthParentElement(env, depth);
        const objDepth = parentChainDepth(expr.object);
        const name = expr.name;
        if (objDepth !== null) {
          return (env) => member(nthParentElement(env, objDepth), name);
        }
        const obj = compileExpr(expr.object);
        return (env) => member(obj(env), name);
      }

      case 'index': {
        const obj = compileExpr(expr.object);
        const idx = compileExpr(expr.index);
        return (env) => {
          const target = obj(env);
          if (!Array.isArray(target)) return undefined;
          const i = idx({ element: undefined, parent: env });
          if (typeof i !== 'number' || !Number.isInteger(i)) return undefined;
          return target[i];
        };
      }

      case 'filter': {
        const obj = compileExpr(expr.object);
        const pred = compileExpr(expr.predicate);
        return (env) => {
          const target = obj(env);
          if (!Array.isArray(target)) return [];
          return target.filter((el) =>
            Boolean(pred({ element: el, parent: env })),
          );
        };
      }

      case 'sort': {
        const obj = compileExpr(expr.object);
        const terms = expr.terms.map((t) => ({
          key: compileExpr(t.key),
          descending: t.descending,
        }));
        return (env) => {
          const target = obj(env);
          if (!Array.isArray(target)) return [];
          // Stable order-by: `toSorted` is stable and non-mutating, so equal
          // elements keep their input order across the whole comparison.
          return target.toSorted((a, b) => {
            for (const term of terms) {
              const ka = term.key({ element: a, parent: env });
              const kb = term.key({ element: b, parent: env });
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
        };
      }

      case 'bracket':
        throw new TypeflowRuntimeError(
          'Unresolved bracket expression: run the compiler before executing a mapping.',
          expr.span,
        );

      case 'project': {
        const obj = compileExpr(expr.object);
        const body = compileObject(expr.body);
        const binder = expr.binder;
        const indexBinder = expr.indexBinder;
        if (binder === undefined && indexBinder === undefined) {
          // No binder: skip the per-element bindings object entirely.
          return (env) => {
            const target = obj(env);
            if (isNullish(target)) return undefined;
            if (Array.isArray(target)) {
              return target.map((el) => body({ element: el, parent: env }));
            }
            return body({ element: target, parent: env });
          };
        }
        const bindEnv = (el: unknown, index: number, env: Env): Env => {
          const bindings: Record<string, unknown> = {};
          if (binder !== undefined) bindings[binder] = el;
          if (indexBinder !== undefined) bindings[indexBinder] = index;
          return { element: el, bindings, parent: env };
        };
        return (env) => {
          const target = obj(env);
          if (isNullish(target)) return undefined;
          if (Array.isArray(target)) {
            return target.map((el, i) => body(bindEnv(el, i, env)));
          }
          return body(bindEnv(target, 0, env));
        };
      }

      case 'unary': {
        const operand = compileExpr(expr.operand);
        if (expr.op === '!') return (env) => !operand(env);
        return (env) => {
          const v = operand(env);
          return typeof v === 'number' ? -v : undefined;
        };
      }

      case 'binary':
        return compileBinary(expr);

      case 'cond': {
        const cond = compileExpr(expr.cond);
        const then = compileExpr(expr.then);
        const els = compileExpr(expr.else);
        return (env) => (cond(env) ? then(env) : els(env));
      }

      case 'call': {
        const args = expr.args.map((a) => compileExpr(a));
        const arity = args.length;
        // Call target frozen at preparation: external > def > builtin, the
        // interpreter's env-chain order (both live on the global env).
        const ext = external[expr.name];
        if (typeof ext === 'function') {
          return (env) => {
            const vals: unknown[] = [];
            for (let i = 0; i < arity; i++) vals.push(args[i]!(env));
            return ext(...vals);
          };
        }
        const def = defs.get(expr.name);
        if (def) {
          const params = def.params;
          const span = expr.span;
          const name = def.name;
          return (env) => {
            if (state.depth >= MAX_CALL_DEPTH) {
              throw new TypeflowRuntimeError(
                `Maximum call depth exceeded while evaluating '${name}'.`,
                span,
              );
            }
            // Missing (optional) arguments still bind their parameter to
            // undefined, so the name shadows outer scopes like the interpreter.
            const bindings: Record<string, unknown> = {};
            for (let i = 0; i < params.length; i++) {
              bindings[params[i]!] = i < arity ? args[i]!(env) : undefined;
            }
            state.depth++;
            try {
              // Params only + globals: the caller's scope (and the input
              // binding) is not visible from a `fn` body.
              return defBody(def)({ bindings });
            } finally {
              state.depth--;
            }
          };
        }
        const impl = BUILTINS[expr.name]?.impl;
        if (!impl) {
          throw new TypeflowRuntimeError(
            `Unknown function '${expr.name}'.`,
            expr.nameSpan,
          );
        }
        return (env) => {
          const vals: unknown[] = [];
          for (let i = 0; i < arity; i++) vals.push(args[i]!(env));
          return impl(vals);
        };
      }

      case 'object':
        return compileObject(expr);

      case 'array': {
        const elements = expr.elements.map((e) => compileExpr(e));
        return (env) => elements.map((op) => op(env));
      }
    }
  }

  function compileBinary(expr: Extract<Expr, { kind: 'binary' }>): Op {
    const op = expr.op;
    const left = compileExpr(expr.left);
    const right = compileExpr(expr.right);

    switch (op) {
      case '??':
        return (env) => left(env) ?? right(env);
      case '&&':
        return (env) => Boolean(left(env)) && Boolean(right(env));
      case '||':
        return (env) => Boolean(left(env)) || Boolean(right(env));
      case '==':
        return (env) => left(env) === right(env);
      case '!=':
        return (env) => left(env) !== right(env);
      case '<':
      case '<=':
      case '>':
      case '>=':
        return (env) => {
          const l = left(env);
          const r = right(env);
          if (isNullish(l) || isNullish(r)) return false;
          const a = l as number | string;
          const b = r as number | string;
          if (op === '<') return a < b;
          if (op === '<=') return a <= b;
          if (op === '>') return a > b;
          return a >= b;
        };
      case '+':
        return (env) => {
          const l = left(env);
          const r = right(env);
          if (isNullish(l) || isNullish(r)) return undefined;
          if (typeof l === 'string' || typeof r === 'string')
            return String(l) + String(r);
          if (typeof l === 'number' && typeof r === 'number') return l + r;
          return undefined;
        };
      case '-':
      case '*':
      case '/':
      case '%':
        return (env) => {
          const l = left(env);
          const r = right(env);
          if (typeof l !== 'number' || typeof r !== 'number') return undefined;
          if (op === '-') return l - r;
          if (op === '*') return l * r;
          if (op === '%') return l % r;
          return l / r;
        };
    }
  }

  const root = compileObject(compiled.ir);
  const inputName = compiled.inputName;

  return (input: unknown) => {
    const prevInput = state.input;
    const prevDepth = state.depth;
    state.input = input;
    state.depth = 0;
    try {
      return root({ bindings: { [inputName]: input } });
    } finally {
      state.input = prevInput;
      state.depth = prevDepth;
    }
  };
}
