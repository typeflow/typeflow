/**
 * Closure-compiling runtime: the IR is walked ONCE at preparation and turned
 * into nested closures — per-node dispatch, `$parent` chain depths, binder
 * presence, call targets and the dangerous-key decision in object literals
 * are all resolved here; execution is direct calls. No `eval` / `new
 * Function`, so strict CSP and the sandbox argument hold unchanged.
 *
 * On top of that, identifiers annotated by the checker are read at a known
 * scope depth instead of walking the env chain, and filter chains fuse with
 * their consumer (`arr[pred] -> {…}`, `arr[pred].name`, `sum`/`count` over
 * them) into a single pass without intermediate arrays.
 *
 * Semantics are identical to the tree-walking interpreter
 * (./interpreter.ts, kept as the reference implementation); the equivalence
 * is asserted by tests.
 */
import {
  type CompiledFn,
  type CompiledMapping,
  type Expr,
  type FilterExpr,
  type ObjectExpr,
  parentChainDepth,
} from '#core';
import { BUILTINS } from '#builtins';
import { isNullish } from '#builtins/values';
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

/** `a[p1][p2]…` flattened: the non-filter base and predicates in filter order. */
function filterChain(expr: FilterExpr): { base: Expr; preds: Expr[] } {
  const preds: Expr[] = [];
  let base: Expr = expr;
  while (base.kind === 'filter') {
    preds.unshift(base.predicate);
    base = base.object;
  }
  return { base, preds };
}

function matches(preds: Op[], elEnv: Env): boolean {
  for (let i = 0; i < preds.length; i++) {
    if (!preds[i]!(elEnv)) return false;
  }
  return true;
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

  // ---- Operator fusion ----
  // A filter chain and its consumer run as ONE pass over the source array:
  // `arr[pred] -> {…}` (filter+project), `arr[pred].name` (filter+member) and
  // `sum`/`count` over those (accumulate in the pass) never materialize the
  // intermediate arrays the unfused forms allocate.

  const defExternalMemo = new Map<string, boolean>();

  function defUsesExternal(def: CompiledFn): boolean {
    const memo = defExternalMemo.get(def.name);
    if (memo !== undefined) return memo;
    // Cycle guard: a recursive call adds no external use by itself.
    defExternalMemo.set(def.name, false);
    const result = usesExternal(def.body);
    defExternalMemo.set(def.name, result);
    return result;
  }

  function objectUsesExternal(node: ObjectExpr): boolean {
    return (
      (node.lets ?? []).some((l) => usesExternal(l.value)) ||
      node.props.some((p) => usesExternal(p.value))
    );
  }

  /** Can evaluating this expression reach a user-provided external function? */
  function usesExternal(expr: Expr): boolean {
    switch (expr.kind) {
      case 'lit':
      case 'ident':
        return false;
      case 'member':
        return usesExternal(expr.object);
      case 'bracket':
        return usesExternal(expr.object) || usesExternal(expr.inner);
      case 'index':
        return usesExternal(expr.object) || usesExternal(expr.index);
      case 'filter':
        return usesExternal(expr.object) || usesExternal(expr.predicate);
      case 'sort':
        return (
          usesExternal(expr.object) ||
          expr.terms.some((t) => usesExternal(t.key))
        );
      case 'project':
        return usesExternal(expr.object) || objectUsesExternal(expr.body);
      case 'unary':
        return usesExternal(expr.operand);
      case 'binary':
        return usesExternal(expr.left) || usesExternal(expr.right);
      case 'cond':
        return (
          usesExternal(expr.cond) ||
          usesExternal(expr.then) ||
          usesExternal(expr.else)
        );
      case 'call': {
        if (expr.args.some((a) => usesExternal(a))) return true;
        // Same shadowing order as the call compilation: external > def >
        // builtin. Builtins are pure by construction.
        if (typeof external[expr.name] === 'function') return true;
        const def = defs.get(expr.name);
        return def !== undefined && defUsesExternal(def);
      }
      case 'object':
        return objectUsesExternal(expr);
      case 'array':
        return expr.elements.some((e) => usesExternal(e));
    }
  }

  /**
   * Compile a filter chain for a fused single pass, or null when fusion is
   * not allowed. Fusion keeps each stage's own call order but interleaves
   * the stages per element instead of running them per stage — observable
   * only if TWO stages call impure external functions, so fusion requires at
   * most one stage (predicate, or the consumer's `body`) that can reach an
   * external. The unfused forms remain the fallback, never an error.
   */
  function fuseFilter(
    expr: FilterExpr,
    body?: ObjectExpr,
  ): { base: Op; preds: Op[] } | null {
    const { base, preds } = filterChain(expr);
    let impure = 0;
    for (const pred of preds) if (usesExternal(pred)) impure++;
    if (body !== undefined && objectUsesExternal(body)) impure++;
    if (impure > 1) return null;
    return { base: compileExpr(base), preds: preds.map((p) => compileExpr(p)) };
  }

  /**
   * `count(arr[pred])`, `sum(arr[pred])` and `sum(arr[pred].name)` fused:
   * an accumulator replaces both the filtered array and (for the member
   * form) the projected number array. Mirrors the builtins exactly: `count`
   * is the number of kept elements; `sum` adds number values only and
   * returns 0 for an empty selection.
   */
  function compileFusedAggregate(name: string, arg: Expr): Op | null {
    if (name === 'count' && arg.kind === 'filter') {
      const fused = fuseFilter(arg);
      if (!fused) return null;
      const { base, preds } = fused;
      return (env) => {
        const target = base(env);
        if (!Array.isArray(target)) return 0;
        let n = 0;
        for (const el of target) {
          if (matches(preds, { element: el, parent: env })) n++;
        }
        return n;
      };
    }
    if (name !== 'sum') return null;
    if (arg.kind === 'filter') {
      const fused = fuseFilter(arg);
      if (!fused) return null;
      const { base, preds } = fused;
      return (env) => {
        const target = base(env);
        if (!Array.isArray(target)) return 0;
        let acc = 0;
        for (const el of target) {
          // Predicates run on every element (like the unfused filter pass);
          // the number check mirrors the builtin's numArr on the survivors.
          if (
            matches(preds, { element: el, parent: env }) &&
            typeof el === 'number'
          ) {
            acc += el;
          }
        }
        return acc;
      };
    }
    if (arg.kind === 'member' && arg.object.kind === 'filter') {
      const fused = fuseFilter(arg.object);
      if (!fused) return null;
      const { base, preds } = fused;
      const memberName = arg.name;
      return (env) => {
        const target = base(env);
        if (!Array.isArray(target)) return 0;
        let acc = 0;
        for (const el of target) {
          if (matches(preds, { element: el, parent: env })) {
            const v = member(el, memberName);
            if (typeof v === 'number') acc += v;
          }
        }
        return acc;
      };
    }
    return null;
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
        if (expr.object.kind === 'filter') {
          // `arr[pred].name` fused: member access distributes over the filter
          // result (always an array), so matching elements project straight
          // into the output without materializing the filtered array.
          const fused = fuseFilter(expr.object);
          if (fused) {
            const { base, preds } = fused;
            return (env) => {
              const target = base(env);
              if (!Array.isArray(target)) return [];
              const out: unknown[] = [];
              for (const el of target) {
                if (matches(preds, { element: el, parent: env })) {
                  out.push(member(el, name));
                }
              }
              return out;
            };
          }
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
        if (expr.object.kind === 'filter') {
          // `a[p1][p2]` fused: chained predicates run in one pass, without
          // the intermediate array per filter level. Predicate scopes are
          // siblings ({element, parent}), so one env serves every predicate.
          const fused = fuseFilter(expr);
          if (fused) {
            const { base, preds } = fused;
            return (env) => {
              const target = base(env);
              if (!Array.isArray(target)) return [];
              const out: unknown[] = [];
              for (const el of target) {
                if (matches(preds, { element: el, parent: env })) out.push(el);
              }
              return out;
            };
          }
        }
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
        const binder = expr.binder;
        const indexBinder = expr.indexBinder;
        if (expr.object.kind === 'filter') {
          // `arr[pred] -> {…}` fused: filter and projection in one pass, no
          // intermediate filtered array.
          const fused = fuseFilter(expr.object, expr.body);
          if (fused) {
            const { base, preds } = fused;
            const body = compileObject(expr.body);
            if (binder === undefined && indexBinder === undefined) {
              return (env) => {
                const target = base(env);
                if (!Array.isArray(target)) return [];
                const out: unknown[] = [];
                for (const el of target) {
                  // Predicates and body see the same scope shape
                  // ({element, parent}), so one env serves the whole element.
                  const elEnv: Env = { element: el, parent: env };
                  if (matches(preds, elEnv)) out.push(body(elEnv));
                }
                return out;
              };
            }
            return (env) => {
              const target = base(env);
              if (!Array.isArray(target)) return [];
              const out: unknown[] = [];
              // The index binder counts kept elements — the element's
              // position in the (never materialized) filtered array.
              let kept = 0;
              for (const el of target) {
                // Binders must not be visible to the predicates, so the body
                // gets its own env carrying the bindings.
                if (matches(preds, { element: el, parent: env })) {
                  const bindings: Record<string, unknown> = {};
                  if (binder !== undefined) bindings[binder] = el;
                  if (indexBinder !== undefined) bindings[indexBinder] = kept;
                  kept++;
                  out.push(body({ element: el, bindings, parent: env }));
                }
              }
              return out;
            };
          }
        }
        const obj = compileExpr(expr.object);
        const body = compileObject(expr.body);
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
        // Call target frozen at preparation: external > def > builtin, the
        // interpreter's env-chain order (both live on the global env).
        const ext = external[expr.name];
        // Aggregation fusion, only when the name actually resolves to the
        // builtin (an external or a def with the same name shadows it).
        if (
          typeof ext !== 'function' &&
          !defs.has(expr.name) &&
          expr.args.length === 1
        ) {
          const fused = compileFusedAggregate(expr.name, expr.args[0]!);
          if (fused) return fused;
        }
        const args = expr.args.map((a) => compileExpr(a));
        const arity = args.length;
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
