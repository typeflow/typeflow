import { type Builtin, type BuiltinGroup, pNum, pStr } from './types';
import { num, str } from './values';
import { T } from '#core';

const functions: Record<string, Builtin> = {
  now: {
    signature: 'now(): string',
    doc: 'Current timestamp, ISO 8601.',
    example: `processedAt: now()`,
    params: [],
    result: T.string,
    impl: () => new Date().toISOString(),
  },
  millis: {
    signature: 'millis(): number',
    doc: 'Current timestamp, milliseconds since the epoch.',
    example: `processedAtMs: millis()`,
    params: [],
    result: T.number,
    impl: () => Date.now(),
  },
  fromMillis: {
    signature: 'fromMillis(millis: number): string',
    doc: 'Epoch milliseconds → ISO 8601 string.',
    example: `created: fromMillis(event.createdAt)`,
    params: [pNum('millis')],
    result: T.string,
    impl: ([v]) =>
      num(v) === undefined ? undefined : new Date(num(v)!).toISOString(),
  },
  toMillis: {
    signature: 'toMillis(timestamp: string): number',
    doc: 'ISO 8601 (or any parseable date) string → epoch milliseconds.',
    example: `createdAtMs: toMillis(event.createdAt)`,
    params: [pStr('timestamp')],
    result: T.number,
    impl: ([v]) => {
      const s = str(v);
      if (s === undefined) return undefined;
      const t = Date.parse(s);
      return Number.isNaN(t) ? undefined : t;
    },
  },
};

/** Date & time — see the generated docs section of the same name. */
export const datetime: BuiltinGroup = {
  id: 'datetime',
  title: 'Date & time',
  doc: '`now()` returns the current ISO 8601 timestamp, `millis()` the epoch milliseconds; `fromMillis`/`toMillis` convert between the two representations.',
  example: {
    mapping: `input event: { createdAt: number }

map {
  created: fromMillis(event.createdAt),
  roundTrip: toMillis(fromMillis(event.createdAt)),
  epoch: fromMillis(0),
}`,
    input: `{ "createdAt": 1751414400000 }`,
  },
  functions,
};
