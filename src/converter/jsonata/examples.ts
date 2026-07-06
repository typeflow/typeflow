/**
 * The "Migration from JSONata" docs page is generated from these examples:
 * each JSONata source is run through the converter at docs-generation time
 * (and the result is compiled), so the page can never show a wrong conversion.
 */
export interface MigrationExample {
  title: string;
  /** Markdown prose rendered before the example. */
  body?: string;
  jsonata: string;
  /** Inline Typeflow input type for the generated playground. */
  inputType: string;
  /** Playground input JSON. */
  input: string;
}

export const MIGRATION_EXAMPLES: MigrationExample[] = [
  {
    title: 'Reshape & concatenate',
    body: "JSONata's `&` concatenation coerces its operands; Typeflow's `+` does not, so the converter wraps non-string operands in `string()`.",
    jsonata: `{
  "fullName": firstName & " " & lastName,
  "ref": "user-" & id,
  "city": address.city
}`,
    inputType:
      '{ firstName: string, lastName: string, id: number, address: { city: string } }',
    input: `{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "id": 42,
  "address": { "city": "London" }
}`,
  },
  {
    title: 'Predicates & aggregation',
    body: 'Array predicates translate one-to-one, and the `$`-prefixed stdlib maps to the same names without the `$`.',
    jsonata: `{
  "expensive": products[price > 100].name,
  "total": $sum(products.price),
  "count": $count(products)
}`,
    inputType: '{ products: { name: string, price: number }[] }',
    input: `{
  "products": [
    { "name": "keyboard", "price": 120 },
    { "name": "cable", "price": 9 },
    { "name": "screen", "price": 300 }
  ]
}`,
  },
  {
    title: 'Higher-order functions become syntax',
    body: 'JSONata lambdas disappear: `$filter` becomes a `[predicate]`, and `$map` (or `arr.{ ... }`) becomes a `->` projection. A `$map` lambda parameter is kept as a projection alias (`-> $v { ... }`), so nested maps can still reach the outer element.',
    jsonata: `{
  "top": $filter(items, function($v) { $v.score > 10 }),
  "views": $map(items, function($v) { { "label": $uppercase($v.name), "score": $v.score } })
}`,
    inputType: '{ items: { name: string, score: number }[] }',
    input: `{
  "items": [
    { "name": "ada", "score": 16 },
    { "name": "alan", "score": 9 }
  ]
}`,
  },
  {
    title: 'Order-by',
    body: "JSONata's `^(...)` order-by translates verbatim: `>` sorts descending, `<` (or a bare key) ascending, and multiple keys are compared in turn. Keys are evaluated in element scope, just like a predicate.",
    jsonata: `orders^(>total, name).{
  "id": id,
  "total": total
}`,
    inputType: '{ orders: { id: number, total: number, name: string }[] }',
    input: `{
  "orders": [
    { "id": 1, "total": 30, "name": "b" },
    { "id": 2, "total": 30, "name": "a" },
    { "id": 3, "total": 50, "name": "c" }
  ]
}`,
  },
  {
    title: 'Variables',
    body: 'A JSONata `( $x := ...; ... )` block returning an object becomes `let` bindings — immutable, block-scoped names for reused subexpressions. (A block that returns a scalar inlines its variables instead.)',
    jsonata: `(
  $base := order.subtotal;
  $tax := $base * 0.2;
  {
    "subtotal": $base,
    "tax": $tax,
    "total": $base + $tax
  }
)`,
    inputType: '{ order: { subtotal: number } }',
    input: `{ "order": { "subtotal": 100 } }`,
  },
  {
    title: 'Per-element block with an index',
    body: "A JSONata `arr#$i.( ...; { ... } )` — a filtered array, a positional index `#$i`, and a per-element block — maps to a `->` projection with an [index binder](/operators/projection#index): `-> _, $i { let ... , ... }`. `$i` gives the element's 0-based position (here for a 1-based, zero-padded id).",
    jsonata: `offers[Result >= $$.threshold]#$i.(
  $rank := $i + 1;
  {
    "id": $pad($string($rank), -4, "0"),
    "score": $.Result,
    "top": $.Result >= 0.9
  }
)`,
    inputType: '{ threshold: number, offers: { Result: number }[] }',
    input: `{
  "threshold": 0.5,
  "offers": [{ "Result": 0.95 }, { "Result": 0.3 }, { "Result": 0.7 }]
}`,
  },
  {
    title: 'Parent & root context',
    body: "JSONata's `$$` (the root document) becomes `$root`, and `%` (the parent of the current context) becomes `$parent`. A multi-level `%.%` that reaches the input becomes `$root` too — here, from inside `items`, `%` is the group and `%.%` is the document.",
    jsonata: `{
  "org": $$.org,
  "groups": groups.{
    "key": key,
    "items": items.{ "label": name, "group": %.key, "org": %.%.org }
  }
}`,
    inputType:
      '{ org: string, groups: { key: string, items: { name: string }[] }[] }',
    input: `{
  "org": "acme",
  "groups": [
    { "key": "g1", "items": [{ "name": "a" }, { "name": "b" }] },
    { "key": "g2", "items": [{ "name": "c" }] }
  ]
}`,
  },
  {
    title: 'Conditionals & string functions',
    jsonata: `{
  "tier": points >= 100 ? "gold" : "standard",
  "slug": $lowercase($replace(name, " ", "-"))
}`,
    inputType: '{ points: number, name: string }',
    input: `{ "points": 132, "name": "Ada Lovelace" }`,
  },
  {
    title: 'Putting it together',
    body: 'One mapping that exercises most of the converter at once: nested objects and `&` concatenation, a `( $var := ...; { ... } )` block, aggregate functions over a filtered array, then a `filter → order-by → per-element block with an index` pipeline whose block adds its own `let` bindings and a ternary tier.',
    jsonata: `{
  "org": $uppercase(company.name),
  "_links": { "self": { "href": "/api/" & company.id & "/report" } },
  "summary": (
    $active := products[inStock = true];
    {
      "count": $count($active),
      "total": $sum($active.price),
      "topPrice": $max($active.price)
    }
  ),
  "products": products[price >= $$.threshold]^(>price)#$i.(
    $rank := $i + 1;
    $tier := $.price >= 100 ? "premium" : "standard";
    {
      "rank": $rank,
      "sku": $pad($string($rank), -6, "0"),
      "label": $uppercase($.name) & " (" & $tier & ")",
      "price": $.price,
      "discounted": $.price * 0.9,
      "tier": $tier
    }
  )
}`,
    inputType:
      '{ company: { name: string, id: string }, threshold: number, products: { name: string, price: number, inStock: boolean }[] }',
    input: `{
  "company": { "name": "acme", "id": "A7" },
  "threshold": 50,
  "products": [
    { "name": "keyboard", "price": 120, "inStock": true },
    { "name": "cable", "price": 9, "inStock": true },
    { "name": "screen", "price": 300, "inStock": false },
    { "name": "mouse", "price": 60, "inStock": true }
  ]
}`,
  },
];
