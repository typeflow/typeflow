import { arr, obj, str } from './values';
import {
  type Builtin,
  type BuiltinGroup,
  isArrayOf,
  isObjectish,
  pAny,
  pObj,
  pStr,
} from './types';
import { makeUnion, T } from '../core';

const functions: Record<string, Builtin> = {
  keys: {
    signature: 'keys(value: object): string[]',
    doc: 'Property names (merged across elements for an array of objects).',
    example: `headerNames: keys(req.headers)`,
    params: [pObj()],
    result: T.array(T.string),
    impl: ([v]) => {
      const o = obj(v);
      if (o !== undefined) return Object.keys(o);
      const xs = arr(v);
      if (xs !== undefined) {
        const seen = new Set<string>();
        for (const el of xs)
          for (const k of Object.keys(obj(el) ?? {})) seen.add(k);
        return [...seen];
      }
      return undefined;
    },
  },
  values: {
    signature: 'values(value: object): unknown[]',
    doc: "Property values, typed as the union of the object's field types.",
    example: `headerValues: values(req.headers)`,
    params: [pObj()],
    result: (args) => {
      const t = args[0];
      if (t?.kind === 'object')
        return T.array(makeUnion(t.fields.map((f) => f.type)));
      return T.array(T.any);
    },
    impl: ([v]) => (obj(v) === undefined ? undefined : Object.values(obj(v)!)),
  },
  lookup: {
    signature: 'lookup(value: object, key: string): unknown',
    doc: 'Value of the given key (mapped over an array of objects).',
    example: `host: lookup(req.headers, "host")`,
    params: [pObj(), pStr('key')],
    result: (args) => {
      const t = args[0];
      if (t?.kind === 'object')
        return makeUnion([...t.fields.map((f) => f.type), T.undefined]);
      return T.any;
    },
    impl: ([v, key]) => {
      const k = str(key);
      if (k === undefined) return undefined;
      const o = obj(v);
      if (o !== undefined) return o[k];
      const xs = arr(v);
      if (xs !== undefined)
        return xs.map((el) => obj(el)?.[k]).filter((x) => x !== undefined);
      return undefined;
    },
  },
  merge: {
    signature: 'merge(objects: object[]): object',
    doc: 'Merges an array of objects left to right.',
    example: `settings: merge([defaults, user.overrides])`,
    params: [{ label: 'object[]', check: isArrayOf(isObjectish) }],
    result: T.any,
    impl: ([v]) => {
      const xs = arr(v);
      if (xs === undefined) return obj(v) ?? undefined;
      return Object.assign({}, ...xs.map((x) => obj(x) ?? {})) as Record<
        string,
        unknown
      >;
    },
  },
  spread: {
    signature: 'spread(value: object): object[]',
    doc: 'Splits an object into an array of single-property objects.',
    example: `entries: spread(req.headers)`,
    params: [pObj()],
    result: T.array(T.any),
    impl: ([v]) => {
      const o = obj(v);
      if (o === undefined) return undefined;
      return Object.entries(o).map(([k, val]) => ({ [k]: val }));
    },
  },
  type: {
    signature: 'type(value: unknown): string',
    doc: '`"string" | "number" | "boolean" | "null" | "array" | "object" | "undefined"`.',
    example: `kind: type(req.headers)`,
    params: [pAny()],
    result: T.string,
    impl: ([v]) => {
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'array';
      return typeof v;
    },
  },
};

/** Objects — see the generated docs section of the same name. */
export const objects: BuiltinGroup = {
  id: 'objects',
  title: 'Objects',
  doc: "`values` and `lookup` are typed against the object's declared fields — `lookup` infers the union of field types.",
  example: {
    mapping: `input req: { headers: { host: string, accept: string } }

map {
  headerNames: keys(req.headers),
  host: lookup(req.headers, "host"),
  merged: merge([{ a: 1 }, { b: 2 }]),
  kind: type(req.headers),
}`,
    input: `{ "headers": { "host": "example.dev", "accept": "application/json" } }`,
  },
  functions,
};
