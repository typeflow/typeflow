/** jq AST -> Typeflow source emission. */
import { ConvertError, type QNode } from './parser';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const FN_MAP: Record<string, string> = {
  length: 'count',
  tostring: 'string',
  tonumber: 'number',
  floor: 'floor',
  ceil: 'ceil',
  round: 'round',
  sqrt: 'sqrt',
  keys: 'keys',
  reverse: 'reverse',
  unique: 'distinct',
  join: 'join',
  split: 'split',
  contains: 'contains',
  ascii_upcase: 'upper',
  ascii_downcase: 'lower',
};

export interface EmitContext {
  inputName: string;
  current: string;
  relative: boolean;
  notes: string[];
}

function q(value: string): string {
  return JSON.stringify(value);
}

function fieldName(value: string): string {
  return IDENT_RE.test(value) ? value : q(value);
}

function elementScope(ctx: EmitContext, current = '$'): EmitContext {
  return { ...ctx, current, relative: true };
}

function rootScope(ctx: EmitContext, current: string): EmitContext {
  return { ...ctx, current, relative: false };
}

export function emit(node: QNode, ctx: EmitContext): string {
  switch (node.kind) {
    case 'num':
      return String(node.value);
    case 'str':
      return q(node.value);
    case 'bool':
      return String(node.value);
    case 'null':
      return 'null';
    case 'input':
      return ctx.current;
    case 'field': {
      const base = emit(node.target, ctx);
      const name = fieldName(node.name);
      if (base === '$') return name;
      return `${base}.${name}`;
    }
    case 'index':
      return `${emit(node.target, ctx)}[${emit(node.index, ctx)}]`;
    case 'iterate':
      ctx.notes.push('jq array iteration `.[]` was converted to the array value itself.');
      return emit(node.target, ctx);
    case 'pipe':
      return emitPipe(node, ctx);
    case 'call':
      return emitCall(node, ctx);
    case 'binary':
      return emitBinary(node, ctx);
    case 'unary':
      return node.op === 'not' ? `!(${emit(node.expr, ctx)})` : `-(${emit(node.expr, ctx)})`;
    case 'object':
      return emitObjectBody(node, ctx);
    case 'array':
      return `[${node.items.map((item) => emit(item, ctx)).join(', ')}]`;
  }
}

export function emitObjectBody(
  node: Extract<QNode, { kind: 'object' }>,
  ctx: EmitContext,
): string {
  const props = node.pairs.map(({ key, value }) => {
    return `${fieldName(key)}: ${emit(value, ctx)}`;
  });
  return `{ ${props.join(', ')} }`;
}

function emitPipe(
  node: Extract<QNode, { kind: 'pipe' }>,
  ctx: EmitContext,
): string {
  const left = emit(node.left, ctx);
  if (node.right.kind === 'object') {
    return `(${left}) -> ${emitObjectBody(node.right, elementScope(ctx))}`;
  }
  return emit(node.right, rootScope(ctx, left));
}

function emitCall(
  node: Extract<QNode, { kind: 'call' }>,
  ctx: EmitContext,
): string {
  if (node.name === 'select' && node.args.length === 1) {
    const predicate = emit(node.args[0]!, elementScope(ctx));
    return `${ctx.current}[${predicate}]`;
  }
  if (node.name === 'map' && node.args.length === 1) {
    const body = emit(node.args[0]!, elementScope(ctx));
    return `(${ctx.current}) -> ${body}`;
  }
  if (node.name === 'sort_by' && node.args.length === 1) {
    const key = emit(node.args[0]!, elementScope(ctx));
    return `${ctx.current} ^(${key})`;
  }
  if (node.name === 'add' && node.args.length === 0) return `sum(${ctx.current})`;

  const mapped = FN_MAP[node.name];
  if (!mapped) {
    throw new ConvertError(`Unsupported jq function '${node.name}'.`);
  }
  const args =
    node.args.length === 0
      ? [ctx.current]
      : node.args.map((arg) => emit(arg, ctx));
  return `${mapped}(${args.join(', ')})`;
}

function emitBinary(
  node: Extract<QNode, { kind: 'binary' }>,
  ctx: EmitContext,
): string {
  const opMap: Record<string, string> = {
    '//': '??',
    '==': '==',
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
  const op = opMap[node.op];
  if (!op) throw new ConvertError(`Unsupported jq operator '${node.op}'.`);
  if (node.op === '//') {
    return `(${emitOptional(node.left, ctx)} ?? ${emit(node.right, ctx)})`;
  }
  return `(${emit(node.left, ctx)} ${op} ${emit(node.right, ctx)})`;
}

function emitOptional(node: QNode, ctx: EmitContext): string {
  if (node.kind !== 'field') return emit(node, ctx);
  const parts: string[] = [];
  let current: QNode = node;
  while (current.kind === 'field') {
    parts.unshift(fieldName(current.name));
    current = current.target;
  }
  const base = emit(current, ctx);
  if (parts.length === 0) return base;
  return `${base}.${parts.join('?.')}`;
}
