import { type DocPage } from '../types';

export const literals: DocPage = {
  id: 'literals',
  title: 'Literals & objects',
  order: 1,
  intro:
    'The leaves of a `map` block are expressions. The simplest expressions are **literals** — fixed values copied to the output as-is. Every example on this page is live: edit the mapping or the input and the output recomputes instantly.',
  items: [
    {
      name: '"…" 0 true null',
      id: 'scalar',
      effect: 'scalar literals: string, number, boolean, null',
      doc: 'Strings use double quotes; numbers, booleans, and `null` look like JSON.',
      snippet: `schema: "order/v2"\nrevision: 7\nratio: 0.5\nactive: true\nlegacyId: null`,
    },
    {
      name: '[ ] { }',
      id: 'array-object',
      effect: 'array and object literals',
      doc: 'Literal arrays and objects can mix fixed values and expressions over the input.',
      snippet: `tags: ["export", "v2"]\nflags: [true, false]\nmeta: { source: "api", author: user.name }`,
    },
    {
      name: 'nested { }',
      id: 'nesting',
      effect: "a field's value can itself be an object of fields",
      doc: 'The shape of the `map` block mirrors the shape of the output.',
      snippet: `user: {\n  id: user.id,\n  profile: {\n    displayName: user.name,\n    version: 1,\n  },\n}`,
    },
  ],
  playground: {
    mapping: `input order: { id: number }

map {
  schema: "order/v2",
  revision: 7,
  ratio: 0.5,
  active: true,
  legacyId: null,
  id: order.id,
}`,
    input: `{ "id": 128 }`,
  },
  outro:
    'Next: [Paths & optionality](/operators/paths) — reading values out of the input.',
};
