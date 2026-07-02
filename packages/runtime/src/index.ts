import type { CompiledMapping, Expr, ObjectExpr } from "@thomasfarineau/typeflow-core";

export class TypeflowRuntimeError extends Error {
  constructor(
    message: string,
    public span?: { start: number; end: number },
  ) {
    super(message);
    this.name = "TypeflowRuntimeError";
  }
}

interface Env {
  bindings?: Record<string, unknown>;
  element?: unknown;
  parent?: Env;
}

const BUILTINS: Record<string, (args: unknown[], span: { start: number; end: number }) => unknown> = {
  upper: ([v]) => (v == null ? undefined : String(v).toUpperCase()),
  lower: ([v]) => (v == null ? undefined : String(v).toLowerCase()),
  trim: ([v]) => (v == null ? undefined : String(v).trim()),
  count: ([v]) => (Array.isArray(v) ? v.length : 0),
  sum: ([v]) =>
    Array.isArray(v) ? v.reduce<number>((acc, x) => acc + (typeof x === "number" ? x : 0), 0) : 0,
  join: ([v, sep]) => (Array.isArray(v) ? v.map((x) => String(x)).join(String(sep ?? "")) : ""),
};

export type MappingFn = (input: unknown) => unknown;

/** Build an executable mapping from a compiled artifact. Compile once, execute many. */
export function createMapping(compiled: CompiledMapping): MappingFn {
  if (compiled.version !== 1) {
    throw new TypeflowRuntimeError(`Unsupported compiled mapping version: ${String(compiled.version)}.`);
  }
  return (input: unknown) => {
    const root: Env = { bindings: { [compiled.inputName]: input } };
    return evalExpr(compiled.ir, root);
  };
}

export function runMapping(compiled: CompiledMapping, input: unknown): unknown {
  return createMapping(compiled)(input);
}

function lookup(name: string, env: Env): unknown {
  for (let e: Env | undefined = env; e; e = e.parent) {
    if (e.element !== undefined || "element" in e) {
      if (name === "$") return e.element;
      const el = e.element;
      if (el !== null && typeof el === "object" && !Array.isArray(el) && Object.hasOwn(el, name)) {
        return (el as Record<string, unknown>)[name];
      }
    }
    if (e.bindings && Object.hasOwn(e.bindings, name)) return e.bindings[name];
  }
  return undefined;
}

function member(value: unknown, name: string): unknown {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    // Path access distributes over arrays, mirroring the checker's typing rule.
    return value.map((el) => member(el, name));
  }
  if (typeof value === "object" && Object.hasOwn(value, name)) {
    return (value as Record<string, unknown>)[name];
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  return Boolean(v);
}

function evalExpr(expr: Expr, env: Env): unknown {
  switch (expr.kind) {
    case "lit":
      return expr.value;

    case "ident":
      return lookup(expr.name, env);

    case "member":
      return member(evalExpr(expr.object, env), expr.name);

    case "index": {
      const target = evalExpr(expr.object, env);
      if (!Array.isArray(target)) return undefined;
      const i = evalExpr(expr.index, { element: undefined, parent: env });
      if (typeof i !== "number" || !Number.isInteger(i)) return undefined;
      return target[i];
    }

    case "filter": {
      const target = evalExpr(expr.object, env);
      if (!Array.isArray(target)) return [];
      return target.filter((el) => truthy(evalExpr(expr.predicate, { element: el, parent: env })));
    }

    case "bracket":
      throw new TypeflowRuntimeError(
        "Unresolved bracket expression: run the compiler before executing a mapping.",
        expr.span,
      );

    case "project": {
      const target = evalExpr(expr.object, env);
      if (target == null) return undefined;
      if (Array.isArray(target)) {
        return target.map((el) => evalObject(expr.body, { element: el, parent: env }));
      }
      return evalObject(expr.body, { element: target, parent: env });
    }

    case "unary": {
      const v = evalExpr(expr.operand, env);
      if (expr.op === "!") return !truthy(v);
      return typeof v === "number" ? -v : undefined;
    }

    case "binary":
      return evalBinary(expr, env);

    case "cond":
      return truthy(evalExpr(expr.cond, env)) ? evalExpr(expr.then, env) : evalExpr(expr.else, env);

    case "call": {
      const fn = BUILTINS[expr.name];
      if (!fn) throw new TypeflowRuntimeError(`Unknown function '${expr.name}'.`, expr.nameSpan);
      return fn(expr.args.map((a) => evalExpr(a, env)), expr.span);
    }

    case "object":
      return evalObject(expr, env);

    case "array":
      return expr.elements.map((e) => evalExpr(e, env));
  }
}

function evalObject(obj: ObjectExpr, env: Env): Record<string, unknown> {
  // Null prototype: output objects cannot collide with Object.prototype members.
  const out: Record<string, unknown> = Object.create(null);
  for (const prop of obj.props) {
    out[prop.name] = evalExpr(prop.value, env);
  }
  // Re-wrap so consumers get a plain object (JSON.stringify, spread, etc. behave normally).
  return { ...out };
}

function evalBinary(expr: Extract<Expr, { kind: "binary" }>, env: Env): unknown {
  const op = expr.op;

  if (op === "??") {
    const left = evalExpr(expr.left, env);
    return left ?? evalExpr(expr.right, env);
  }
  if (op === "&&") {
    return truthy(evalExpr(expr.left, env)) && truthy(evalExpr(expr.right, env));
  }
  if (op === "||") {
    return truthy(evalExpr(expr.left, env)) || truthy(evalExpr(expr.right, env));
  }

  const left = evalExpr(expr.left, env);
  const right = evalExpr(expr.right, env);

  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (left == null || right == null) return false;
      const l = left as number | string;
      const r = right as number | string;
      if (op === "<") return l < r;
      if (op === "<=") return l <= r;
      if (op === ">") return l > r;
      return l >= r;
    }
    case "+": {
      if (left == null || right == null) return undefined;
      if (typeof left === "string" || typeof right === "string") return String(left) + String(right);
      if (typeof left === "number" && typeof right === "number") return left + right;
      return undefined;
    }
    case "-":
    case "*":
    case "/": {
      if (typeof left !== "number" || typeof right !== "number") return undefined;
      if (op === "-") return left - right;
      if (op === "*") return left * right;
      return left / right;
    }
  }
}
