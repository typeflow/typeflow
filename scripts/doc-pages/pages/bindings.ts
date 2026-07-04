import { type DocPage } from '../types';

export const bindings: DocPage = {
  id: 'bindings',
  title: 'Bindings',
  order: 8,
  intro:
    "`let name = expr` names a subexpression inside a block so it can be reused — Typeflow's take on JSONata's `$x := ...`. Bindings are immutable and don't appear in the output; they exist only to avoid repetition and make intent clear.",
  items: [
    {
      name: 'let name = expr',
      id: 'let',
      effect: 'name a subexpression for reuse',
      doc: 'A `let` binding is visible to every property of its block. It computes once and reads as an ordinary identifier — `total: base + tax` instead of repeating the underlying paths.',
      snippet: `let base = order.subtotal\nlet tax = base * 0.2\ntotal: base + tax`,
    },
    {
      name: 'block scope',
      id: 'scope',
      effect: 'bindings reach into nested blocks',
      doc: 'A binding is scoped to its block and every nested block within it, so a projection body (or a nested object) can add its own bindings and still see the outer ones.',
      snippet: `lines: order.items -> {\n  let net = price * qty,\n  net: net,\n  withTax: net * 1.2,\n}`,
    },
    {
      name: 'declaration order',
      id: 'order',
      effect: 'a binding sees only earlier bindings',
      doc: 'All of a block’s properties may use any of its bindings, but a binding may only reference bindings declared **before** it — forward and self references are rejected (`TF2001`), so mappings stay terminating. Two bindings with the same name in one block is an error (`TF2018`).',
      snippet: `let base = order.subtotal\nlet withTax = base * 1.2`,
    },
  ],
  playground: {
    mapping: `input order: { subtotal: number, items: { price: number, qty: number }[] }

map {
  let base = order.subtotal,
  let tax = base * 0.2,
  subtotal: base,
  tax: tax,
  total: base + tax,
  lines: order.items -> {
    let net = price * qty,
    net: net,
    withTax: net * 1.2,
  },
}`,
    input: `{
  "subtotal": 100,
  "items": [{ "price": 10, "qty": 2 }, { "price": 5, "qty": 4 }]
}`,
  },
  outro:
    'For logic you want to reuse across mappings — not just within one block — reach for a [function](/functions/custom) instead: `fn` for pure mapping-language helpers, `use` for typed host functions.',
};
