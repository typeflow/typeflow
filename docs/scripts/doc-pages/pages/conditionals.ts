import { type DocPage } from '../types';

export const conditionals: DocPage = {
  id: 'conditionals',
  title: 'Conditionals',
  order: 5,
  items: [
    {
      name: '? :',
      id: 'ternary',
      effect: 'the only branching construct',
      doc: 'The condition must be a boolean; the result type is the **union of both branches**. Ternaries nest to express ladders — indentation is free-form.',
      snippet: `tier: user.points >= 100 ? "gold"\n    : user.points >= 50 ? "silver"\n    : "bronze"`,
    },
    {
      name: '??',
      id: 'nullish-vs-ternary',
      effect: 'reacts only to null/undefined, not a general conditional',
      doc: '`??` is not a general conditional — it only reacts to `null`/`undefined`, while `? :` branches on any boolean.',
      snippet: `displayName: user.nickname ?? user.firstName\nbadge: user.verified ? "verified" : "unverified"`,
    },
  ],
  playground: {
    mapping: `input user: { points: number }

map {
  tier: user.points >= 100 ? "gold" : "standard",
}`,
    input: `{ "points": 132 }`,
  },
  outro:
    'Note the inferred type of `tier`: `"gold" | "standard"`, not just `string`.\n\nNext: [Arrays](/operators/arrays).',
};
