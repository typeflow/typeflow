import { makeUnion, T, type Type } from '#core';

export interface BuiltinParam {
  label: string;
  check: (t: Type) => boolean;
  optional?: boolean;
}

/**
 * A single builtin: type signature (checked at compile time), runtime
 * implementation, and reference documentation — one definition, one place.
 * The docs site generates its function tables from these entries.
 */
export interface Builtin {
  params: BuiltinParam[];
  /** Result type, or a function of the (checked) argument types for polymorphic results. */
  result: Type | ((argTypes: Type[]) => Type);
  signature: string;
  /** One-line reference description, rendered in the generated docs. */
  doc?: string;
  /** Small static .typeflow snippet illustrating the function, rendered under its own heading. */
  example?: string;
  /** Sub-category within the group (e.g. "Encoding" within Strings), for docs grouping. Functions sharing a category should be adjacent in the group's `functions` object. */
  category?: string;
  /** Runtime implementation. Absent for `use`-declared external functions. */
  impl?: (args: unknown[]) => unknown;
}

/**
 * A documented category of builtins. `doc` and `example` are the section's
 * reference documentation — `docs/functions/<id>.md` is generated
 * entirely from these groups (see scripts/generate-docs).
 */
export interface BuiltinGroup {
  id: string;
  title: string;
  /** Section prose (markdown), rendered after the generated signature table. */
  doc?: string;
  /** Live playground example for the section: mapping source + input JSON. */
  example?: { mapping: string; input: string };
  functions: Record<string, Builtin>;
}

// ---- type predicates (used by the checker for operators too) ----

function partsOf(t: Type): Type[] {
  return t.kind === 'union' ? t.types : [t];
}

export function isStringish(t: Type): boolean {
  return partsOf(t).every(
    (p) =>
      p.kind === 'string' ||
      p.kind === 'any' ||
      (p.kind === 'literal' && typeof p.value === 'string'),
  );
}

export function isNumberish(t: Type): boolean {
  return partsOf(t).every(
    (p) =>
      p.kind === 'number' ||
      p.kind === 'any' ||
      (p.kind === 'literal' && typeof p.value === 'number'),
  );
}

export function isBooleanish(t: Type): boolean {
  return partsOf(t).every(
    (p) =>
      p.kind === 'boolean' ||
      p.kind === 'any' ||
      (p.kind === 'literal' && typeof p.value === 'boolean'),
  );
}

export function isScalarish(t: Type): boolean {
  return partsOf(t).every(
    (p) =>
      p.kind === 'string' ||
      p.kind === 'number' ||
      p.kind === 'boolean' ||
      p.kind === 'literal' ||
      p.kind === 'any',
  );
}

export function isObjectish(t: Type): boolean {
  return partsOf(t).every((p) => p.kind === 'object' || p.kind === 'any');
}

export function isArrayOf(
  elementCheck: (t: Type) => boolean,
): (t: Type) => boolean {
  return (t) =>
    t.kind === 'any' ||
    partsOf(t).every(
      (p) =>
        p.kind === 'any' ||
        (p.kind === 'array' &&
          (p.element.kind === 'any' || elementCheck(p.element))),
    );
}

export const anyType = (_t: Type) => true;

export function elementOf(t: Type): Type {
  if (t.kind === 'array') return t.element;
  if (t.kind === 'union') return makeUnion(partsOf(t).map(elementOf));
  return T.any;
}

/** Result = the (array) type of argument `i`, so sort/reverse/distinct preserve their input type. */
export function sameAs(i: number): (argTypes: Type[]) => Type {
  return (argTypes) => argTypes[i] ?? T.any;
}

// ---- parameter shorthands ----

export const pStr = (label = 'string'): BuiltinParam => ({
  label,
  check: isStringish,
});
export const pNum = (label = 'number'): BuiltinParam => ({
  label,
  check: isNumberish,
});
export const pNumOpt = (label = 'number'): BuiltinParam => ({
  label,
  check: isNumberish,
  optional: true,
});
export const pStrOpt = (label = 'string'): BuiltinParam => ({
  label,
  check: isStringish,
  optional: true,
});
export const pAny = (label = 'unknown'): BuiltinParam => ({
  label,
  check: anyType,
});
export const pArr = (label = 'unknown[]'): BuiltinParam => ({
  label,
  check: isArrayOf(anyType),
});
export const pNumArr = (): BuiltinParam => ({
  label: 'number[]',
  check: isArrayOf(isNumberish),
});
export const pStrArr = (): BuiltinParam => ({
  label: 'string[]',
  check: isArrayOf(isStringish),
});
export const pObj = (): BuiltinParam => ({
  label: 'object',
  check: isObjectish,
});
