/** JSONata AST → Typeflow source emission. */
import { ConvertError, type JNode } from './parser';

/** JSONata stdlib → Typeflow builtin names (same argument order). */
const FN_MAP: Record<string, string> = {
  uppercase: 'upper',
  lowercase: 'lower',
  trim: 'trim',
  string: 'string',
  length: 'length',
  substring: 'substring',
  pad: 'pad',
  contains: 'contains',
  split: 'split',
  join: 'join',
  replace: 'replace',
  base64encode: 'base64encode',
  base64decode: 'base64decode',
  encodeUrl: 'encodeUrl',
  decodeUrl: 'decodeUrl',
  encodeUrlComponent: 'encodeUrlComponent',
  decodeUrlComponent: 'decodeUrlComponent',
  number: 'number',
  abs: 'abs',
  floor: 'floor',
  ceil: 'ceil',
  round: 'round',
  power: 'power',
  sqrt: 'sqrt',
  formatBase: 'formatBase',
  random: 'random',
  sum: 'sum',
  max: 'max',
  min: 'min',
  average: 'average',
  boolean: 'boolean',
  not: 'not',
  exists: 'exists',
  count: 'count',
  append: 'append',
  sort: 'sort',
  reverse: 'reverse',
  distinct: 'distinct',
  shuffle: 'shuffle',
  zip: 'zip',
  keys: 'keys',
  lookup: 'lookup',
  merge: 'merge',
  spread: 'spread',
  type: 'type',
  now: 'now',
  millis: 'millis',
  fromMillis: 'fromMillis',
  toMillis: 'toMillis',
};

/** Calls whose result is a string — `&` operands from these skip string() wrapping. */
const STRING_RESULT_FNS = new Set([
  'upper',
  'lower',
  'trim',
  'string',
  'substring',
  'pad',
  'replace',
  'join',
  'base64encode',
  'base64decode',
  'encodeUrl',
  'decodeUrl',
  'encodeUrlComponent',
  'decodeUrlComponent',
  'formatBase',
  'now',
  'fromMillis',
]);

export interface EmitContext {
  /** Name of the Typeflow input binding, prefixed on root-relative paths. */
  inputName: string;
  /** Inside a predicate/projection, relative names resolve on the element. */
  relative: boolean;
  /** Lambda parameter bound to the element via `$` (filter predicates, no alias). */
  elementParam?: string;
  /** Lambda params bound through `->` aliases, emitted verbatim (e.g. `$v`). */
  boundParams?: ReadonlySet<string>;
  /** Block variables inlined by value (used when a block returns a scalar). */
  inlineVars?: ReadonlyMap<string, string>;
  /** Number of enclosing element scopes (projection/predicate bodies), for `%` parents. */
  elementDepth?: number;
  /** Unknown `$fn`s encountered → arity, emitted as stub `fn` mocks. */
  stubs: Map<string, number>;
  notes: string[];
}

/** Enter an element scope (projection body, predicate, sort key): relative + one level deeper. */
function elementScope(
  ctx: EmitContext,
  extra: Partial<EmitContext> = {},
): EmitContext {
  return {
    ...ctx,
    relative: true,
    elementParam: undefined,
    elementDepth: (ctx.elementDepth ?? 0) + 1,
    ...extra,
  };
}

function q(value: string): string {
  return JSON.stringify(value);
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function emitsString(node: JNode): boolean {
  if (node.kind === 'str') return true;
  if (node.kind === 'binary' && node.op === '&') return true;
  if (node.kind === 'call') {
    const mapped = FN_MAP[node.name];
    return mapped !== undefined && STRING_RESULT_FNS.has(mapped);
  }
  return false;
}

export function emit(node: JNode, ctx: EmitContext): string {
  switch (node.kind) {
    case 'num':
      return String(node.value);
    case 'str':
      return q(node.value);
    case 'bool':
      return String(node.value);
    case 'null':
      return 'null';

    case 'name': {
      // A block variable returning a scalar is inlined by value.
      const inlined = ctx.inlineVars?.get(node.value);
      if (inlined !== undefined) return inlined;
      // A lambda param bound through a `->` alias is emitted verbatim (e.g. `$v`).
      if (ctx.boundParams?.has(node.value)) return node.value;
      if (node.value === ctx.elementParam) return '$';
      const name = IDENT_RE.test(node.value) ? node.value : q(node.value);
      return ctx.relative ? name : `${ctx.inputName}.${name}`;
    }

    case 'context':
      return ctx.relative ? '$' : ctx.inputName;

    case 'root':
      // JSONata `$$` is the root document. `$root` reaches the input through any
      // nesting — unlike the bare input name, which an element field can shadow.
      return '$root';

    case 'parent': {
      // JSONata `%` is the parent context, `%.%` the grandparent, and so on.
      // `$parent` reaches one enclosing element; anything at or beyond the
      // outermost element is the input (`$root`). A strictly-intermediate level
      // in 3+-deep nesting has no single-token form — alias it instead.
      const depth = node.depth;
      const enclosing = ctx.elementDepth ?? 0;
      if (depth <= 1) return '$parent';
      // Reaches the input → `$root` (shorter and clearer than a long chain);
      // a strictly-intermediate ancestor → a `$parent.$parent…` chain.
      if (depth >= enclosing) return '$root';
      return Array.from({ length: depth }, () => '$parent').join('.');
    }

    case 'dot': {
      // `arr.{ ... }` and `arr.( ...; { ... } )` — per-element projection. The
      // parenthesized block maps to a `->` body with `let` bindings.
      if (
        node.right.kind === 'object' ||
        (node.right.kind === 'block' && node.right.result.kind === 'object')
      ) {
        // A `#$i` positional binding on the source becomes an index binder:
        // `arr#$i.( ... )` → `arr -> _, $i { ... }` (`$i` stays reachable in the
        // body). `_` is the (unused) element alias — bare fields still read the
        // element.
        const source =
          node.left.kind === 'bind' && node.left.op === '#'
            ? node.left
            : undefined;
        const bodyCtx = elementScope(
          ctx,
          source
            ? {
                boundParams: new Set([
                  ...(ctx.boundParams ?? []),
                  source.variable,
                ]),
              }
            : {},
        );
        const body = emit(node.right, bodyCtx);
        const arrow = source ? `-> _, ${source.variable} ` : '-> ';
        return `(${emit(source ? source.target : node.left, ctx)}) ${arrow}${body}`;
      }
      if (node.right.kind === 'name') {
        const base =
          node.left.kind === 'name' && node.left.value === ctx.elementParam
            ? '$'
            : emit(node.left, ctx);
        // `$v.field` reads on the element: bare identifier in typeflow.
        if (base === '$') return node.right.value;
        return `${base}.${node.right.value}`;
      }
      throw new ConvertError('Unsupported path step.');
    }

    case 'predicate': {
      const target = emit(node.target, ctx);
      const inner = emit(node.expr, elementScope(ctx));
      return `${target}[${inner}]`;
    }

    case 'sort': {
      // JSONata `arr^(>a, b)` → Typeflow `arr ^(>a, b)`; keys are element-scoped.
      const target = emit(node.target, ctx);
      const terms = node.terms
        .map(({ key, descending }) => {
          const inner = emit(key, elementScope(ctx));
          return `${descending ? '>' : ''}${inner}`;
        })
        .join(', ');
      return `${target} ^(${terms})`;
    }

    case 'block':
      return emitBlock(node, ctx);

    case 'call':
      return emitCall(node, ctx);

    case 'lambda':
      throw new ConvertError(
        'Lambdas are only supported as $map/$filter arguments.',
      );

    case 'bind':
      throw new ConvertError(
        '@/# binds are not supported — reshape explicitly.',
      );

    case 'binary':
      return emitBinary(node, ctx);

    case 'ternary':
      return `(${emit(node.cond, ctx)} ? ${emit(node.then, ctx)} : ${emit(node.else, ctx)})`;

    case 'object':
      return emitObjectBody(node, ctx);

    case 'array':
      return `[${node.items.map((item) => emit(item, ctx)).join(', ')}]`;

    case 'neg':
      return `-(${emit(node.operand, ctx)})`;
  }
}

export function emitObjectBody(
  node: Extract<JNode, { kind: 'object' }>,
  ctx: EmitContext,
): string {
  const props = node.pairs.map(({ key, value }) => {
    const name = IDENT_RE.test(key) ? key : q(key);
    return `${name}: ${emit(value, ctx)}`;
  });
  return `{ ${props.join(', ')} }`;
}

function emitBlock(
  node: Extract<JNode, { kind: 'block' }>,
  ctx: EmitContext,
): string {
  // A JSONata `( $x := e; ... )` block. When it returns an object constructor,
  // the bindings become Typeflow `let`s (immutable, block-scoped). Otherwise
  // the variables are inlined by value into the result — sound because
  // bindings are immutable and side-effect free.
  if (node.result.kind === 'object') {
    const bound = new Set(ctx.boundParams ?? []);
    const lets = node.bindings.map(({ name, value }) => {
      const line = `let ${name} = ${emit(value, { ...ctx, boundParams: new Set(bound) })}`;
      bound.add(name);
      return line;
    });
    const props = node.result.pairs.map(({ key, value }) => {
      const propName = IDENT_RE.test(key) ? key : q(key);
      return `${propName}: ${emit(value, { ...ctx, boundParams: bound })}`;
    });
    return `{ ${[...lets, ...props].join(', ')} }`;
  }

  const inlineVars = new Map(ctx.inlineVars ?? []);
  for (const { name, value } of node.bindings) {
    inlineVars.set(
      name,
      `(${emit(value, { ...ctx, inlineVars: new Map(inlineVars) })})`,
    );
  }
  return emit(node.result, { ...ctx, inlineVars });
}

function emitCall(
  node: Extract<JNode, { kind: 'call' }>,
  ctx: EmitContext,
): string {
  // Higher-order JSONata functions map onto language constructs.
  if (node.name === 'filter' && node.args.length === 2) {
    const [target, lambda] = node.args;
    if (lambda!.kind === 'lambda' && lambda!.params.length === 1) {
      const inner = emit(
        lambda!.body,
        elementScope(ctx, { elementParam: lambda!.params[0] }),
      );
      return `${emit(target!, ctx)}[${inner}]`;
    }
  }
  if (node.name === 'map' && node.args.length === 2) {
    const [target, lambda] = node.args;
    if (
      lambda!.kind === 'lambda' &&
      lambda!.params.length === 1 &&
      lambda!.body.kind === 'object'
    ) {
      // The lambda param becomes a `->` alias, so nested `$map`s keep access to
      // the outer element (`$g.key` inside an inner map still resolves).
      const param = lambda!.params[0]!;
      const body = emitObjectBody(
        lambda!.body,
        elementScope(ctx, {
          boundParams: new Set([...(ctx.boundParams ?? []), param]),
        }),
      );
      return `(${emit(target!, ctx)}) -> ${param} ${body}`;
    }
    throw new ConvertError(
      '$map is only supported with a single-parameter lambda returning an object — use `->` projection.',
    );
  }
  if (node.name === 'substringBefore' && node.args.length === 2) {
    ctx.notes.push(
      '$substringBefore was converted to a split()[0] idiom; behavior differs when the separator is absent.',
    );
    return `(split(${emit(node.args[0]!, ctx)}, ${emit(node.args[1]!, ctx)})[0] ?? "")`;
  }
  if (node.name === 'substringAfter' && node.args.length === 2) {
    ctx.notes.push(
      '$substringAfter was converted to a split()[1] idiom; behavior differs when the separator is absent.',
    );
    return `(split(${emit(node.args[0]!, ctx)}, ${emit(node.args[1]!, ctx)})[1] ?? "")`;
  }

  const mapped = FN_MAP[node.name];
  if (!mapped) {
    // No stdlib equivalent: emit a stub `fn` mock (declared later) so the output
    // still compiles. The user replaces its body — or swaps in a `use` function.
    const arity = node.args.length;
    ctx.stubs.set(node.name, Math.max(ctx.stubs.get(node.name) ?? 0, arity));
    ctx.notes.push(
      `$${node.name} has no Typeflow equivalent — a stub \`fn ${node.name}\` was generated; implement it or replace it with a \`use\`/\`defineFunction\`.`,
    );
    const stubArgs = node.args.map((a) => emit(a, ctx));
    return `${node.name}(${stubArgs.join(', ')})`;
  }
  const args = node.args.map((a) => emit(a, ctx));
  return `${mapped}(${args.join(', ')})`;
}

/** A mock `fn` declaration for an unknown JSONata function: params in, first arg out. */
export function stubFn(name: string, arity: number): string {
  const params = Array.from({ length: arity }, (_, i) => `a${i}: unknown`).join(
    ', ',
  );
  const bodyExpr = arity > 0 ? 'a0' : 'null';
  return `fn ${name}(${params}): unknown = ${bodyExpr}`;
}

function emitBinary(
  node: Extract<JNode, { kind: 'binary' }>,
  ctx: EmitContext,
): string {
  const OP_MAP: Record<string, string> = {
    '=': '==',
    '!=': '!=',
    '<': '<',
    '<=': '<=',
    '>': '>',
    '>=': '>=',
    '+': '+',
    '-': '-',
    '*': '*',
    '/': '/',
    '%': '%',
    and: '&&',
    or: '||',
  };

  if (node.op === '&') {
    const left = emitsString(node.left)
      ? emit(node.left, ctx)
      : `string(${emit(node.left, ctx)})`;
    const right = emitsString(node.right)
      ? emit(node.right, ctx)
      : `string(${emit(node.right, ctx)})`;
    return `(${left} + ${right})`;
  }
  if (node.op === 'in') {
    // `v in list` → is `v` a member of the array? Filter the list to the
    // matching elements and check the count. The value is emitted in the
    // current scope; the `$ == ...` predicate is element-scoped.
    ctx.notes.push(
      '`in` was rewritten to `count(list[$ == value]) > 0`; if the tested value is a bare field of an enclosing `->` element, alias that element so the comparison reads the right scope.',
    );
    return `(count(${emit(node.right, ctx)}[$ == ${emit(node.left, ctx)}]) > 0)`;
  }
  const op = OP_MAP[node.op];
  if (!op) {
    throw new ConvertError(`Unsupported operator '${node.op}'.`);
  }
  return `(${emit(node.left, ctx)} ${op} ${emit(node.right, ctx)})`;
}
