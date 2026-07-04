import { type DocPage } from '../types';

export const comparisons: DocPage = {
  id: 'comparisons',
  title: 'Comparisons & logic',
  order: 4,
  items: [
    {
      name: '== != < <= > >=',
      id: 'compare',
      effect: 'compare two values, produce a boolean',
      doc: 'Comparing values whose types have **no overlap** — a number against a string, say — can never be true. The compiler warns (`TF2367`) instead of letting the mapping silently return `false` forever. Remove the mismatched literal to fix it — it is a warning, not an error, so the mapping still runs.',
      snippet: `isAdult: user.age >= 18\nisAdmin: user.role == "admin"\npassed: user.score > 50`,
    },
    {
      name: '&&',
      id: 'and',
      effect: 'logical AND — both operands must be boolean',
      doc: '`&&`, `||`, and `!` require boolean operands — no truthiness on strings or numbers. `user.active && user.age` is rejected (`TF2004`) since `age` is not boolean.',
      snippet: `canPost: user.active && user.verified`,
    },
    {
      name: '||',
      id: 'or',
      effect: 'logical OR — both operands must be boolean',
      snippet: `needsReview: !user.verified || user.age < 16`,
    },
    {
      name: '!',
      id: 'not',
      effect: 'boolean negation',
      snippet: `blocked: !user.verified`,
    },
  ],
  playground: {
    mapping: `input user: { active: boolean, verified: boolean, age: number }

map {
  canPost: user.active && user.verified,
  needsReview: !user.verified || user.age < 16,
}`,
    input: `{ "active": true, "verified": false, "age": 15 }`,
  },
  outro: 'Next: [Conditionals](/operators/conditionals).',
};
