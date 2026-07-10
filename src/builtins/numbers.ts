import {
  type Builtin,
  type BuiltinGroup,
  isScalarish,
  pNum,
  pNumOpt,
} from './types';
import { num, roundHalfEven } from './values';
import { T } from '#core';

const functions: Record<string, Builtin> = {
  // ---- Conversion ----
  number: {
    signature: 'number(value: string | number | boolean): number',
    doc: 'Parses strings and booleans into a number (`undefined` if not parseable).',
    example: `taxRate: number(item.taxRateStr)`,
    category: 'Conversion',
    params: [{ label: 'string | number | boolean', check: isScalarish }],
    result: T.number,
    impl: ([v]) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isNaN(n) ? undefined : n;
      }
      return undefined;
    },
  },
  formatBase: {
    signature: 'formatBase(value: number, radix?: number): string',
    doc: 'Renders an integer in the given radix (2–36, default 10).',
    example: `hex: formatBase(color.value, 16)`,
    category: 'Conversion',
    params: [pNum(), pNumOpt('radix')],
    result: T.string,
    impl: ([v, radix]) => {
      const n = num(v);
      if (n === undefined) return undefined;
      const r = num(radix) ?? 10;
      if (r < 2 || r > 36) return undefined;
      return Math.round(n).toString(r);
    },
  },

  // ---- Rounding ----
  floor: {
    signature: 'floor(value: number): number',
    doc: 'Rounds down to the nearest integer.',
    example: `pages: floor(catalog.items / pageSize)`,
    category: 'Rounding',
    params: [pNum()],
    result: T.number,
    impl: ([v]) => (num(v) === undefined ? undefined : Math.floor(num(v)!)),
  },
  ceil: {
    signature: 'ceil(value: number): number',
    doc: 'Rounds up to the nearest integer.',
    example: `pages: ceil(catalog.items / pageSize)`,
    category: 'Rounding',
    params: [pNum()],
    result: T.number,
    impl: ([v]) => (num(v) === undefined ? undefined : Math.ceil(num(v)!)),
  },
  round: {
    signature: 'round(value: number, precision?: number): number',
    doc: 'Rounds to `precision` digits, half-to-even like JSONata.',
    example: `total: round(item.price * item.qty, 2)`,
    category: 'Rounding',
    params: [pNum(), pNumOpt('precision')],
    result: T.number,
    impl: ([v, precision]) => {
      const n = num(v);
      return n === undefined
        ? undefined
        : roundHalfEven(n, num(precision) ?? 0);
    },
  },

  // ---- Math ----
  abs: {
    signature: 'abs(value: number): number',
    doc: 'Absolute value.',
    example: `delta: abs(order.total - order.paid)`,
    category: 'Math',
    params: [pNum()],
    result: T.number,
    impl: ([v]) => (num(v) === undefined ? undefined : Math.abs(num(v)!)),
  },
  power: {
    signature: 'power(base: number, exponent: number): number',
    doc: '`base` raised to `exponent`.',
    example: `area: power(shape.side, 2)`,
    category: 'Math',
    params: [pNum('base'), pNum('exponent')],
    result: T.number,
    impl: ([base, exp]) => {
      const b = num(base);
      const e = num(exp);
      return b === undefined || e === undefined ? undefined : b ** e;
    },
  },
  sqrt: {
    signature: 'sqrt(value: number): number',
    doc: 'Square root (`undefined` for negative input).',
    example: `side: sqrt(shape.area)`,
    category: 'Math',
    params: [pNum()],
    result: T.number,
    impl: ([v]) => {
      const n = num(v);
      return n === undefined || n < 0 ? undefined : Math.sqrt(n);
    },
  },

  // ---- Random ----
  random: {
    signature: 'random(): number',
    doc: 'Pseudo-random number in [0, 1).',
    example: `jitter: random() * 100`,
    category: 'Random',
    params: [],
    result: T.number,
    impl: () => Math.random(),
  },
};

/** Numbers — see the generated docs section of the same name. */
export const numbers: BuiltinGroup = {
  id: 'numbers',
  title: 'Numbers',
  doc: 'Rounding is half-to-even (`round(2.5)` is `2`), matching JSONata and XPath.',
  example: {
    mapping: `input item: { price: number, qty: number, taxRate: string }

map {
  total: round(item.price * item.qty * (1 + number(item.taxRate)), 2),
  parsed: number("42.5"),
  hex: formatBase(255, 16),
  root: sqrt(81),
}`,
    input: `{ "price": 19.99, "qty": 3, "taxRate": "0.2" }`,
  },
  functions,
};
