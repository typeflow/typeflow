import { type DocPage } from '../types';

export const arrays: DocPage = {
  id: 'arrays',
  title: 'Arrays',
  order: 6,
  intro:
    'Typeflow has no loops — array work is done with four postfix constructs (distribution, `[filter]`, `[index]`, `^(sort)`) plus [projection](/operators/projection) and the aggregate [functions](/functions/arrays).',
  items: [
    {
      name: '.',
      id: 'distribution',
      effect: 'distribute a property access over array elements',
      doc: 'Accessing a property **on an array of objects** distributes over the elements — `labels.name` on `{ name: string }[]` yields `string[]`.',
      snippet: `names: user.labels.name`,
    },
    {
      name: '[bool]',
      id: 'filter',
      effect: 'keep elements matching a boolean predicate',
      doc: 'A boolean expression in brackets keeps matching elements. Inside the brackets you are in **element scope**: bare identifiers resolve on the element. The predicate must be boolean — `user.labels[name]` is rejected (`TF2009`).',
      snippet: `active: user.labels[active]\nactiveNames: user.labels[active].name`,
    },
    {
      name: '[number]',
      id: 'index',
      effect: 'access an element by index',
      doc: 'Indexing yields `element | undefined` (the array may be shorter), so further access needs `?.`.',
      snippet: `first: user.labels[0]\nfirstName: user.labels[0]?.name\nfirstOr: user.labels[0]?.name ?? "none"`,
    },
    {
      name: '^(key)',
      id: 'sort',
      effect: 'sort elements by one or more keys',
      doc: 'Sorts a copy of the array by each key in turn. Keys are expressions in **element scope**; prefix a key with `>` for descending (`<` or nothing for ascending). A key must be a `number` or a `string` (`TF2011`); nullish keys sort last.',
      snippet: `alphabetical: user.labels^(name).name\nbestFirst: user.labels^(>score, name)`,
    },
    {
      name: 'count / sum / join',
      id: 'aggregate',
      effect: 'collapse an array to a scalar',
      doc: 'See [Functions](/functions/arrays) for the full aggregate list.',
      snippet: `games: count(stats.scores)\ntotal: sum(stats.scores)\ntagLine: join(stats.tags, ", ")`,
    },
  ],
  playground: {
    mapping: `input stats: { scores: number[], tags: string[] }

map {
  games: count(stats.scores),
  total: sum(stats.scores),
  tagLine: join(stats.tags, ", "),
}`,
    input: `{ "scores": [10, 20, 12], "tags": ["math", "pioneer"] }`,
  },
  outro: 'Next: [Projection](/operators/projection).',
};
