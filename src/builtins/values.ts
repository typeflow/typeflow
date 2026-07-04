/** Runtime value coercion helpers shared by the builtin implementations. */

export const isNullish = (v: unknown): v is null | undefined =>
  v === null || v === undefined;

export const str = (v: unknown): string | undefined =>
  isNullish(v) ? undefined : String(v);

export const num = (v: unknown): number | undefined =>
  typeof v === 'number' && !Number.isNaN(v) ? v : undefined;

export const arr = (v: unknown): unknown[] | undefined =>
  Array.isArray(v) ? v : undefined;

export const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

export const numArr = (v: unknown): number[] | undefined =>
  Array.isArray(v)
    ? v.filter((x): x is number => typeof x === 'number')
    : undefined;

/** JSONata-style truthiness: empty strings/arrays/objects and 0 are false. */
export function effectiveBoolean(v: unknown): boolean {
  if (isNullish(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.some(effectiveBoolean);
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** XPath-style round-half-to-even, as JSONata's $round. */
export function roundHalfEven(value: number, precision: number): number {
  const factor = 10 ** precision;
  const x = value * factor;
  const floor = Math.floor(x);
  const diff = x - floor;
  let r: number;
  if (diff > 0.5) r = floor + 1;
  else if (diff < 0.5) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / factor;
}

/** Deep-equality key for distinct(): objects compare structurally. */
export function distinctKey(v: unknown): string {
  return v !== null && typeof v === 'object'
    ? `o:${JSON.stringify(v)}`
    : `${typeof v}:${String(v)}`;
}
