/** Infer an inline Typeflow input type from a sample JSON value. */

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fieldName(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function renderObject(obj: Record<string, unknown>): string {
  const fields = Object.entries(obj).map(
    ([key, value]) => `${fieldName(key)}: ${render(value)}`,
  );
  return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`;
}

/** Arrays of objects merge their elements: missing-somewhere keys become optional. */
function renderMergedObjects(objs: Record<string, unknown>[]): string {
  const keys: string[] = [];
  for (const o of objs)
    for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
  const fields = keys.map((key) => {
    const present = objs.filter((o) => Object.hasOwn(o, key));
    const kinds = [...new Set(present.map((o) => render(o[key])))];
    const type = kinds.length === 1 ? kinds[0]! : kinds.join(' | ');
    const optional = present.length < objs.length ? '?' : '';
    return `${fieldName(key)}${optional}: ${type}`;
  });
  return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`;
}

function render(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'unknown[]';
    if (v.every(isPlainObject)) return `${renderMergedObjects(v)}[]`;
    const kinds = [...new Set(v.map(render))];
    return kinds.length === 1 ? `${kinds[0]}[]` : `(${kinds.join(' | ')})[]`;
  }
  if (isPlainObject(v)) return renderObject(v);
  return 'unknown';
}

/**
 * Render the inline Typeflow type of a sample JSON value, e.g.
 * `{ "id": 1, "tags": ["a"] }` → `{ id: number, tags: string[] }`.
 */
export function typeFromSample(value: unknown): string {
  return render(value);
}
