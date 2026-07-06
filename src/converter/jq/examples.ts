/**
 * The "Migration from jq" docs page is generated from these examples:
 * each jq source is run through the converter at docs-generation time and the
 * result is compiled, so the page cannot drift from converter behavior.
 */
export interface JqMigrationExample {
  title: string;
  body?: string;
  jq: string;
  inputType: string;
  input: string;
}

export const JQ_MIGRATION_EXAMPLES: JqMigrationExample[] = [
  {
    title: 'Reshape paths',
    body: 'jq object constructors and path reads map directly to Typeflow object fields and typed paths.',
    jq: `{
  fullName: (.firstName + " " + .lastName),
  city: .address.city
}`,
    inputType:
      '{ firstName: string, lastName: string, address: { city: string } }',
    input: `{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "address": { "city": "London" }
}`,
  },
  {
    title: 'Filter arrays',
    body: 'A jq `.[] | select(...) | .field` pipeline becomes a Typeflow filter followed by a path read.',
    jq: `.products[] | select(.price > 100) | .name`,
    inputType: '{ products: { name: string, price: number }[] }',
    input: `{
  "products": [
    { "name": "keyboard", "price": 120 },
    { "name": "cable", "price": 9 }
  ]
}`,
  },
  {
    title: 'Project arrays',
    body: 'jq `map({...})` becomes a Typeflow `->` projection.',
    jq: `.items | map({
  label: .name,
  score: .score
})`,
    inputType: '{ items: { name: string, score: number }[] }',
    input: `{
  "items": [
    { "name": "ada", "score": 16 },
    { "name": "alan", "score": 9 }
  ]
}`,
  },
  {
    title: 'Sort and project',
    body: 'jq `sort_by` maps to Typeflow order-by, then the resulting array can be projected.',
    jq: `.orders | sort_by(.total) | map({
  id: .id,
  total: .total
})`,
    inputType: '{ orders: { id: number, total: number }[] }',
    input: `{
  "orders": [
    { "id": 2, "total": 50 },
    { "id": 1, "total": 30 }
  ]
}`,
  },
  {
    title: 'Putting it together',
    body: 'A compact jq mapping that reshapes account fields, filters and projects products, sorts orders, and uses `add` for an aggregate-like total.',
    jq: `{
  customer: {
    name: (.user.firstName + " " + .user.lastName),
    city: .user.address.city
  },
  expensiveProducts: .products[] | select(.price > 100) | .name,
  catalog: .products | map({
    label: .name,
    price: .price
  }),
  orderIds: .orders | sort_by(.total) | map({ id: .id }),
  total: .totals | add
}`,
    inputType:
      '{ user: { firstName: string, lastName: string, address: { city: string } }, products: { name: string, price: number }[], orders: { id: number, total: number }[], totals: number[] }',
    input: `{
  "user": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "address": { "city": "London" }
  },
  "products": [
    { "name": "keyboard", "price": 120 },
    { "name": "cable", "price": 9 }
  ],
  "orders": [
    { "id": 2, "total": 50 },
    { "id": 1, "total": 30 }
  ],
  "totals": [120, 9]
}`,
  },
];
