import { T, type Type } from "@thomasfarineau/typeflow-core";

export interface BuiltinParam {
  label: string;
  check: (t: Type) => boolean;
}

export interface Builtin {
  params: BuiltinParam[];
  result: Type;
  signature: string;
}

function partsOf(t: Type): Type[] {
  return t.kind === "union" ? t.types : [t];
}

export function isStringish(t: Type): boolean {
  return partsOf(t).every(
    (p) => p.kind === "string" || p.kind === "any" || (p.kind === "literal" && typeof p.value === "string"),
  );
}

export function isNumberish(t: Type): boolean {
  return partsOf(t).every(
    (p) => p.kind === "number" || p.kind === "any" || (p.kind === "literal" && typeof p.value === "number"),
  );
}

export function isBooleanish(t: Type): boolean {
  return partsOf(t).every(
    (p) => p.kind === "boolean" || p.kind === "any" || (p.kind === "literal" && typeof p.value === "boolean"),
  );
}

function isArrayOf(elementCheck: (t: Type) => boolean): (t: Type) => boolean {
  return (t) =>
    t.kind === "any" ||
    partsOf(t).every((p) => p.kind === "any" || (p.kind === "array" && (p.element.kind === "any" || elementCheck(p.element))));
}

const anyType = (_t: Type) => true;

export const BUILTINS: Record<string, Builtin> = {
  upper: {
    params: [{ label: "string", check: isStringish }],
    result: T.string,
    signature: "upper(value: string): string",
  },
  lower: {
    params: [{ label: "string", check: isStringish }],
    result: T.string,
    signature: "lower(value: string): string",
  },
  trim: {
    params: [{ label: "string", check: isStringish }],
    result: T.string,
    signature: "trim(value: string): string",
  },
  count: {
    params: [{ label: "unknown[]", check: isArrayOf(anyType) }],
    result: T.number,
    signature: "count(items: unknown[]): number",
  },
  sum: {
    params: [{ label: "number[]", check: isArrayOf(isNumberish) }],
    result: T.number,
    signature: "sum(items: number[]): number",
  },
  join: {
    params: [
      { label: "string[]", check: isArrayOf(isStringish) },
      { label: "string", check: isStringish },
    ],
    result: T.string,
    signature: "join(items: string[], separator: string): string",
  },
};
