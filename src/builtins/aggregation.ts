import { type Builtin, type BuiltinGroup, pNumArr } from './types';
import { numArr } from './values';
import { T } from '../core';

const functions: Record<string, Builtin> = {
  sum: {
    signature: 'sum(items: number[]): number',
    doc: 'Sum of the numbers (0 for an empty array).',
    example: `total: sum(order.prices)`,
    params: [pNumArr()],
    result: T.number,
    impl: ([v]) => {
      const xs = numArr(v);
      return xs === undefined ? 0 : xs.reduce((acc, x) => acc + x, 0);
    },
  },
  max: {
    signature: 'max(items: number[]): number',
    doc: 'Largest number (`undefined` for an empty array).',
    example: `priciest: max(order.prices)`,
    params: [pNumArr()],
    result: T.number,
    impl: ([v]) => {
      const xs = numArr(v);
      return xs === undefined || xs.length === 0 ? undefined : Math.max(...xs);
    },
  },
  min: {
    signature: 'min(items: number[]): number',
    doc: 'Smallest number (`undefined` for an empty array).',
    example: `cheapest: min(order.prices)`,
    params: [pNumArr()],
    result: T.number,
    impl: ([v]) => {
      const xs = numArr(v);
      return xs === undefined || xs.length === 0 ? undefined : Math.min(...xs);
    },
  },
  average: {
    signature: 'average(items: number[]): number',
    doc: 'Arithmetic mean (`undefined` for an empty array).',
    example: `mean: average(order.prices)`,
    params: [pNumArr()],
    result: T.number,
    impl: ([v]) => {
      const xs = numArr(v);
      return xs === undefined || xs.length === 0
        ? undefined
        : xs.reduce((a, x) => a + x, 0) / xs.length;
    },
  },
};

/** Aggregation — see the generated docs section of the same name. */
export const aggregation: BuiltinGroup = {
  id: 'aggregation',
  title: 'Aggregation',
  doc: '`max`, `min` and `average` return `undefined` for an empty array; `sum` returns `0`.',
  example: {
    mapping: `input order: { prices: number[] }

map {
  total: sum(order.prices),
  cheapest: min(order.prices),
  priciest: max(order.prices),
  mean: average(order.prices),
}`,
    input: `{ "prices": [19.99, 5.5, 12.25] }`,
  },
  functions,
};
