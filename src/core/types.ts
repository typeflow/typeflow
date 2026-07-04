/** Typeflow's internal structural type model — the JSON-relevant subset of TypeScript's type system. */

export type Type =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'unknown' }
  | { kind: 'any' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'array'; element: Type }
  | { kind: 'object'; fields: ObjectField[] }
  | { kind: 'union'; types: Type[] };

export interface ObjectField {
  name: string;
  type: Type;
  optional: boolean;
}

export const T = {
  string: { kind: 'string' } as Type,
  number: { kind: 'number' } as Type,
  boolean: { kind: 'boolean' } as Type,
  null: { kind: 'null' } as Type,
  undefined: { kind: 'undefined' } as Type,
  unknown: { kind: 'unknown' } as Type,
  any: { kind: 'any' } as Type,
  literal(value: string | number | boolean): Type {
    return { kind: 'literal', value };
  },
  array(element: Type): Type {
    return { kind: 'array', element };
  },
  object(fields: ObjectField[]): Type {
    return { kind: 'object', fields };
  },
  union(types: Type[]): Type {
    return makeUnion(types);
  },
};

/** Stable structural key, used to deduplicate union members. */
export function typeKey(t: Type): string {
  switch (t.kind) {
    case 'literal':
      return `lit:${typeof t.value}:${JSON.stringify(t.value)}`;
    case 'array':
      return `arr:${typeKey(t.element)}`;
    case 'object':
      return `obj:{${t.fields
        .map(
          (f) =>
            `${JSON.stringify(f.name)}${f.optional ? '?' : ''}:${typeKey(f.type)}`,
        )
        .join(',')}}`;
    case 'union':
      return `uni:${t.types.map(typeKey).toSorted().join('|')}`;
    default:
      return t.kind;
  }
}

/** Build a normalized union: flatten, dedupe, absorb literals into their base type, collapse singletons. */
export function makeUnion(types: Type[]): Type {
  const flat: Type[] = [];
  const push = (t: Type) => {
    if (t.kind === 'union') t.types.forEach(push);
    else flat.push(t);
  };
  types.forEach(push);

  if (flat.some((t) => t.kind === 'any')) return T.any;

  const hasString = flat.some((t) => t.kind === 'string');
  const hasNumber = flat.some((t) => t.kind === 'number');
  const hasBoolean = flat.some((t) => t.kind === 'boolean');
  const hasTrue = flat.some((t) => t.kind === 'literal' && t.value === true);
  const hasFalse = flat.some((t) => t.kind === 'literal' && t.value === false);

  const seen = new Set<string>();
  const out: Type[] = [];
  for (const t of flat) {
    // Literals are absorbed by their base type if it is also present.
    if (t.kind === 'literal') {
      if (typeof t.value === 'string' && hasString) continue;
      if (typeof t.value === 'number' && hasNumber) continue;
      if (typeof t.value === 'boolean' && (hasBoolean || (hasTrue && hasFalse)))
        continue;
    }
    const key = typeKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  // true | false collapses to boolean.
  if (hasTrue && hasFalse && !hasBoolean) out.push(T.boolean);

  // Readability: nullish members go last (`string | null`, not `null | string`).
  const ordered = [
    ...out.filter((t) => t.kind !== 'null' && t.kind !== 'undefined'),
    ...out.filter((t) => t.kind === 'null' || t.kind === 'undefined'),
  ];

  if (ordered.length === 0) return T.unknown;
  if (ordered.length === 1) return ordered[0]!;
  return { kind: 'union', types: ordered };
}

/** Does the type include null or undefined (directly or as a union member)? */
export function containsNullish(t: Type): boolean {
  if (t.kind === 'null' || t.kind === 'undefined') return true;
  if (t.kind === 'union') return t.types.some(containsNullish);
  return false;
}

export function containsUndefined(t: Type): boolean {
  if (t.kind === 'undefined') return true;
  if (t.kind === 'union') return t.types.some(containsUndefined);
  return false;
}

/** Remove null and undefined from a type. */
export function stripNullish(t: Type): Type {
  if (t.kind === 'null' || t.kind === 'undefined') return T.unknown;
  if (t.kind === 'union') {
    const rest = t.types.filter(
      (x) => x.kind !== 'null' && x.kind !== 'undefined',
    );
    return makeUnion(rest);
  }
  return t;
}

/** Remove only undefined from a type. */
export function stripUndefined(t: Type): Type {
  if (t.kind === 'undefined') return T.unknown;
  if (t.kind === 'union') {
    return makeUnion(t.types.filter((x) => x.kind !== 'undefined'));
  }
  return t;
}

/** Union members after removing nullish parts; a non-union type yields itself. */
export function nonNullishParts(t: Type): Type[] {
  if (t.kind === 'union') {
    return t.types.filter((x) => x.kind !== 'null' && x.kind !== 'undefined');
  }
  if (t.kind === 'null' || t.kind === 'undefined') return [];
  return [t];
}

/**
 * Pragmatic structural assignability: can a value of type `source` be passed
 * where `target` is expected? Objects are matched structurally (extra source
 * fields are fine); `any` on either side accepts.
 */
export function typeSatisfies(source: Type, target: Type): boolean {
  if (
    source.kind === 'any' ||
    target.kind === 'any' ||
    target.kind === 'unknown'
  )
    return true;
  if (source.kind === 'union')
    return source.types.every((s) => typeSatisfies(s, target));
  if (target.kind === 'union')
    return target.types.some((t) => typeSatisfies(source, t));
  if (target.kind === 'literal') {
    return source.kind === 'literal' && source.value === target.value;
  }
  switch (source.kind) {
    case 'literal':
      return typeof source.value === target.kind;
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'undefined':
      return source.kind === target.kind;
    case 'unknown':
      return false;
    case 'array':
      return (
        target.kind === 'array' && typeSatisfies(source.element, target.element)
      );
    case 'object': {
      if (target.kind !== 'object') return false;
      return target.fields.every((tf) => {
        const sf = source.fields.find((f) => f.name === tf.name);
        if (!sf) return tf.optional;
        const sourceType = sf.optional
          ? makeUnion([sf.type, T.undefined])
          : sf.type;
        const targetType = tf.optional
          ? makeUnion([tf.type, T.undefined])
          : tf.type;
        return typeSatisfies(sourceType, targetType);
      });
    }
    default:
      return false;
  }
}

const INLINE_LIMIT = 60;

/** Render a type as TypeScript syntax. Objects go multiline past a width threshold. */
export function typeToString(t: Type, indent = ''): string {
  const inline = typeToInline(t);
  if (inline.length <= INLINE_LIMIT || t.kind !== 'object') return inline;
  const inner = indent + '  ';
  const fields = t.fields
    .map(
      (f) =>
        `${inner}${fieldName(f.name)}${f.optional ? '?' : ''}: ${typeToString(f.type, inner)};`,
    )
    .join('\n');
  return `{\n${fields}\n${indent}}`;
}

function typeToInline(t: Type): string {
  switch (t.kind) {
    case 'literal':
      return JSON.stringify(t.value);
    case 'array': {
      const el = typeToInline(t.element);
      return t.element.kind === 'union' ? `(${el})[]` : `${el}[]`;
    }
    case 'object':
      if (t.fields.length === 0) return '{}';
      return `{ ${t.fields
        .map(
          (f) =>
            `${fieldName(f.name)}${f.optional ? '?' : ''}: ${typeToInline(f.type)}`,
        )
        .join('; ')} }`;
    case 'union':
      return t.types.map(typeToInline).join(' | ');
    default:
      return t.kind;
  }
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function fieldName(name: string): string {
  return IDENT_RE.test(name) ? name : JSON.stringify(name);
}
