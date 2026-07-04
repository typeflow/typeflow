import { type DocPage } from '../types';

export const projection: DocPage = {
  id: 'projection',
  title: 'Projection',
  order: 7,
  intro:
    "`array -> { ... }` maps **each element** of an array to a new object shape. It is Typeflow's replacement for `Array.prototype.map`.",
  items: [
    {
      name: '->',
      id: 'project',
      effect: 'map each element of an array to a new object shape',
      doc: 'Inside the projection body, bare identifiers resolve on the current element, and `$` is the element itself. Postfix constructs chain — filter first (`arr[bool] -> { ... }`), then reshape the survivors.',
      snippet: `views: user.labels -> {\n  label: upper(name),\n  active: active,\n  original: $,\n}`,
    },
    {
      name: '$',
      id: 'element',
      effect: 'the current element (required for scalar arrays)',
      doc: 'For arrays of scalars, `$` is the only way to reference the element.',
      snippet: `detailed: stats.scores -> {\n  value: $,\n  doubled: $ * 2,\n  passed: $ >= 12,\n}`,
    },
    {
      name: '-> alias',
      id: 'binder',
      effect: 'name the current element',
      doc: 'Since bare identifiers resolve on the current element, an element field **shadows** an outer variable of the same name — including the input. Give the element an explicit alias with `-> alias { ... }` and reference its fields through the alias; bare names, the alias, and `$` all stay available, and the parent scope is never shadowed.',
      snippet: `views: user.labels -> l {\n  label: upper(l.name),\n  active: l.active,\n  original: $,\n}`,
    },
    {
      name: '-> alias, index',
      id: 'index',
      effect: 'name the element and its 0-based position',
      doc: 'A second binder captures the element’s **0-based index** in the array as a `number` — useful for ordinals or sequential ids. Both binders are named: `-> el, i { ... }`. The element also stays reachable as `$` and through bare fields, so name the element `_` when you only need the index.',
      snippet: `ranked: board.scores -> s, i {\n  rank: i + 1,\n  score: s,\n}`,
    },
    {
      name: '$root, $parent',
      id: 'root-parent',
      effect: 'reach the input or the enclosing element',
      doc: 'When you stay in the bare-field style, `$root` reaches the **input** through any level of nesting — even past a field that shadows it — and `$parent` reaches the **enclosing** projection or filter element. Chain it — `$parent.$parent` climbs two levels, `$parent.$parent.$parent` three — and a chain that climbs past every enclosing element lands on the input. At the top level (a single `->`), the element has no enclosing element, so `$parent` is already the input, the same as `$root`.',
      snippet: `regions: doc.regions -> {\n  code: code,\n  cities: cities -> {\n    districts: districts -> {\n      name: name,\n      city: $parent.name,\n      region: $parent.$parent.code,\n    },\n  },\n}`,
    },
  ],
  playground: {
    mapping: `input user: { org: string, labels: { name: string, active: boolean }[] }

map {
  activeViews: user.labels[active] -> l {
    label: upper(l.name),
    slug: lower(l.name),
    org: $root.org,
  },
}`,
    input: `{
  "org": "acme",
  "labels": [
    { "name": "Founder", "active": true },
    { "name": "Legacy", "active": false },
    { "name": "Math", "active": true }
  ]
}`,
  },
  outro:
    'Projection bodies are full map bodies: they can nest objects, use conditionals, call functions — anything a top-level field can do. Use an alias (`-> l { ... }`) whenever an element field would shadow a name you still need, and `$root` / `$parent` to reach outward from inside the body.',
};
