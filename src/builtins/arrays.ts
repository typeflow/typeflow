import { arr, distinctKey, isNullish, str } from './values';
import {
  type Builtin,
  type BuiltinGroup,
  elementOf,
  isArrayOf,
  isNumberish,
  isStringish,
  pArr,
  pStrArr,
  pStrOpt,
  sameAs,
} from './types';
import { makeUnion, T } from '../core';

const functions: Record<string, Builtin> = {
  // ---- Measure ----
  count: {
    signature: 'count(items: unknown[]): number',
    doc: 'Number of elements.',
    example: `total: count(order.items)`,
    category: 'Measure',
    params: [pArr()],
    result: T.number,
    impl: ([v]) => (Array.isArray(v) ? v.length : 0),
  },

  // ---- Combine ----
  join: {
    signature: 'join(items: string[], separator?: string): string',
    doc: 'Concatenates the strings with a separator (default `""`).',
    example: `csv: join(user.tags, ", ")`,
    category: 'Combine',
    params: [pStrArr(), pStrOpt('separator')],
    result: T.string,
    impl: ([v, sep]) =>
      Array.isArray(v) ? v.map((x) => String(x)).join(str(sep) ?? '') : '',
  },
  append: {
    signature: 'append(first: unknown[], second: unknown[]): unknown[]',
    doc: 'Concatenates two arrays.',
    example: `all: append(data.names, data.scores)`,
    category: 'Combine',
    params: [pArr('first'), pArr('second')],
    result: (args) =>
      T.array(
        makeUnion([elementOf(args[0] ?? T.any), elementOf(args[1] ?? T.any)]),
      ),
    impl: ([a, b]) => {
      if (isNullish(a)) return isNullish(b) ? undefined : b;
      if (isNullish(b)) return a;
      return [...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])];
    },
  },
  zip: {
    signature: 'zip(first: unknown[], second: unknown[]): unknown[][]',
    doc: 'Pairs elements by index, truncated to the shorter array.',
    example: `paired: zip(data.names, data.scores)`,
    category: 'Combine',
    params: [pArr('first'), pArr('second')],
    result: (args) =>
      T.array(
        T.array(
          makeUnion([elementOf(args[0] ?? T.any), elementOf(args[1] ?? T.any)]),
        ),
      ),
    impl: ([a, b]) => {
      const xs = arr(a);
      const ys = arr(b);
      if (xs === undefined || ys === undefined) return undefined;
      const n = Math.min(xs.length, ys.length);
      return Array.from({ length: n }, (_, i) => [xs[i], ys[i]]);
    },
  },

  // ---- Reorder ----
  sort: {
    signature: 'sort(items: string[] | number[]): string[] | number[]',
    doc: 'Sorts in natural ascending order; the result keeps the input type.',
    example: `ranked: sort(data.scores)`,
    category: 'Reorder',
    params: [
      {
        label: 'string[] | number[]',
        check: (t) => isArrayOf(isStringish)(t) || isArrayOf(isNumberish)(t),
      },
    ],
    result: sameAs(0),
    impl: ([v]) => {
      const xs = arr(v);
      if (xs === undefined) return undefined;
      return xs.toSorted((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        const sa = String(a);
        const sb = String(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    },
  },
  reverse: {
    signature: 'reverse(items: unknown[]): unknown[]',
    doc: 'Reverses the order; the result keeps the input type.',
    example: `latestFirst: reverse(data.scores)`,
    category: 'Reorder',
    params: [pArr()],
    result: sameAs(0),
    impl: ([v]) => (arr(v) === undefined ? undefined : arr(v)!.toReversed()),
  },
  shuffle: {
    signature: 'shuffle(items: unknown[]): unknown[]',
    doc: 'Random permutation; keeps the input type.',
    example: `deckOrder: shuffle(deck.cards)`,
    category: 'Reorder',
    params: [pArr()],
    result: sameAs(0),
    impl: ([v]) => {
      const xs = arr(v);
      if (xs === undefined) return undefined;
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  },

  // ---- Dedupe ----
  distinct: {
    signature: 'distinct(items: unknown[]): unknown[]',
    doc: 'Removes duplicates (deep equality for objects); keeps the input type.',
    example: `unique: distinct(data.names)`,
    category: 'Dedupe',
    params: [pArr()],
    result: sameAs(0),
    impl: ([v]) => {
      const xs = arr(v);
      if (xs === undefined) return undefined;
      const seen = new Set<string>();
      return xs.filter((x) => {
        const k = distinctKey(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
  },
};

/** Arrays — see the generated docs section of the same name. */
export const arrays: BuiltinGroup = {
  id: 'arrays',
  title: 'Arrays',
  doc:
    '`sort`, `reverse`, and `distinct` **preserve the input type**: `sort(scores)` on `number[]` infers `number[]`.\n\n' +
    "For element-wise transformation and filtering, use the language constructs — [`->` projection](/operators/projection) and [`[predicate]` filters](/operators/arrays) — instead of JSONata's `$map`/`$filter` lambdas.",
  example: {
    mapping: `input data: { scores: number[], names: string[] }

map {
  ranked: reverse(sort(data.scores)),
  unique: distinct(data.names),
  merged: append(data.names, data.scores),
  paired: zip(data.names, data.scores),
  csv: join(data.names, ", "),
}`,
    input: `{ "scores": [12, 3, 12, 7], "names": ["ada", "alan", "ada"] }`,
  },
  functions,
};
