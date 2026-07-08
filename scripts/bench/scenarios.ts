/**
 * Benchmark scenarios: the SAME transformation written four ways — a
 * Typeflow mapping, a JSONata expression, a REAL jq filter (executed by the
 * actual jq codebase compiled to WebAssembly, via jq-wasm), and a
 * hand-written JS function (the native ceiling). The docs' benchmark page
 * runs them in the visitor's browser; scripts/generate-docs.ts verifies at
 * build time that all four produce identical output, so the page can't
 * compare apples to oranges.
 */

export interface BenchScenario {
  id: string;
  title: { en: string; fr: string };
  note: { en: string; fr: string };
  /** Typeflow mapping source (compiled once, run per iteration). */
  typeflow: string;
  /** Equivalent JSONata expression (parsed once, evaluated per iteration). */
  jsonata: string;
  /**
   * Equivalent jq filter, in real jq (run by jq-wasm; must produce exactly
   * one output value). NOT converter syntax: `.a[] | select(...)` inside an
   * object literal would fan out into one object per element in actual jq.
   */
  jq: string;
  /** Name of the Typeflow input binding (kept for converter-based tooling). */
  inputName: string;
  /** Equivalent hand-written function — displayed via String(js). */
  js: (input: never) => unknown;
  /** Deterministic input generator; n scales the array sizes. */
  makeInput: (n: number) => unknown;
  sizes: number[];
  defaultSize: number;
}

interface User {
  id: number;
  firstName: string;
  lastName: string;
  role: string;
  contact?: { email?: string };
  labels: { name: string; active: boolean }[];
  scores: number[];
}

interface Catalog {
  threshold: number;
  products: { name: string; price: number; inStock: boolean }[];
}

export const BENCH_SCENARIOS: BenchScenario[] = [
  {
    id: 'reshape',
    title: {
      en: 'Reshape an API response',
      fr: 'Remodeler une réponse d’API',
    },
    note: {
      en: 'Paths, optional access with a default, comparison, string concatenation, a filter and an aggregate — the everyday mapping.',
      fr: 'Chemins, accès optionnel avec défaut, comparaison, concaténation, un filtre et un agrégat — le mapping de tous les jours.',
    },
    typeflow: `input user: {
  id: number,
  firstName: string,
  lastName: string,
  role: "admin" | "member" | "guest",
  contact?: { email?: string },
  labels: { name: string, active: boolean }[],
  scores: number[],
}

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  isAdmin: user.role == "admin",
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
  total: sum(user.scores),
}`,
    jsonata: `{
  "id": id,
  "fullName": firstName & " " & lastName,
  "isAdmin": role = "admin",
  "email": contact.email ? contact.email : "unknown",
  "activeTags": [labels[active].name],
  "total": $sum(scores)
}`,
    jq: `{
  id: .id,
  fullName: (.firstName + " " + .lastName),
  isAdmin: (.role == "admin"),
  email: (.contact.email // "unknown"),
  activeTags: [.labels[] | select(.active) | .name],
  total: (.scores | add)
}`,
    inputName: 'user',
    js: (user: User) => ({
      id: user.id,
      fullName: user.firstName + ' ' + user.lastName,
      isAdmin: user.role === 'admin',
      email: user.contact?.email ?? 'unknown',
      activeTags: user.labels.filter((l) => l.active).map((l) => l.name),
      total: user.scores.reduce((a, b) => a + b, 0),
    }),
    makeInput: (n: number): User => ({
      id: 42,
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'admin',
      contact: {},
      labels: Array.from({ length: n }, (_, i) => ({
        name: `tag-${i}`,
        active: i % 2 === 0,
      })),
      scores: Array.from({ length: n }, (_, i) => (i * 7) % 20),
    }),
    sizes: [10, 1000, 10000],
    defaultSize: 1000,
  },
  {
    id: 'catalog',
    title: {
      en: 'Filter, project, aggregate',
      fr: 'Filtrer, projeter, agréger',
    },
    note: {
      en: 'A product catalog: count and sum over a filtered array, then a projection with a function call — the array-heavy path.',
      fr: 'Un catalogue produits : comptage et somme sur un tableau filtré, puis une projection avec appel de fonction — le chemin chargé en tableaux.',
    },
    typeflow: `input data: {
  threshold: number,
  products: { name: string, price: number, inStock: boolean }[],
}

map {
  inStock: count(data.products[inStock]),
  stockValue: sum(data.products[inStock].price),
  featured: data.products[price >= $root.threshold] -> {
    label: upper(name),
    price: price,
  },
}`,
    jsonata: `{
  "inStock": $count(products[inStock]),
  "stockValue": $sum(products[inStock].price),
  "featured": [products[price >= $$.threshold].{ "label": $uppercase(name), "price": price }]
}`,
    jq: `.threshold as $t | {
  inStock: ([.products[] | select(.inStock)] | length),
  stockValue: ([.products[] | select(.inStock) | .price] | add),
  featured: [.products[] | select(.price >= $t) | {
    label: (.name | ascii_upcase),
    price: .price
  }]
}`,
    inputName: 'data',
    js: (data: Catalog) => {
      const inStock = data.products.filter((p) => p.inStock);
      return {
        inStock: inStock.length,
        stockValue: inStock.reduce((a, p) => a + p.price, 0),
        featured: data.products
          .filter((p) => p.price >= data.threshold)
          .map((p) => ({ label: p.name.toUpperCase(), price: p.price })),
      };
    },
    makeInput: (n: number): Catalog => ({
      threshold: 50,
      products: Array.from({ length: n }, (_, i) => ({
        name: `product-${i}`,
        price: (i * 13) % 100,
        inStock: i % 3 !== 0,
      })),
    }),
    sizes: [10, 1000, 10000],
    defaultSize: 1000,
  },
];
