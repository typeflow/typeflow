import { type DocPage } from '../types';

export const arithmetic: DocPage = {
  id: 'arithmetic',
  title: 'Arithmetic & strings',
  order: 3,
  intro:
    'Arithmetic operators work on numbers, with the usual precedence (use parentheses to group). `+` also concatenates strings — but never mixes the two: `string + number` is a compile error (`TF2004`), not silent coercion.',
  items: [
    {
      name: '+',
      id: 'add',
      effect: 'add numbers, or concatenate strings',
      doc: 'Between two numbers, adds. Between two strings, concatenates. Mixing a string and a number is `TF2004` — convert explicitly with `string(...)` first.',
      snippet: `total: item.price + item.tax\nfullName: user.firstName + " " + user.lastName`,
    },
    {
      name: '-',
      id: 'subtract',
      effect: 'subtract numbers',
      snippet: `remaining: order.total - order.paid`,
    },
    {
      name: '*',
      id: 'multiply',
      effect: 'multiply numbers',
      snippet: `subtotal: item.price * item.quantity`,
    },
    {
      name: '/',
      id: 'divide',
      effect: 'divide numbers',
      snippet: `unitPrice: item.subtotal / item.quantity`,
    },
    {
      name: '%',
      id: 'modulo',
      effect: 'remainder of division',
      snippet: `isEvenQty: item.quantity % 2 == 0`,
    },
  ],
  playground: {
    mapping: `input item: { price: number, quantity: number, taxRate: number }

map {
  subtotal: item.price * item.quantity,
  tax: item.price * item.quantity * item.taxRate,
  total: item.price * item.quantity * (1 + item.taxRate),
  isEvenQty: item.quantity % 2 == 0,
}`,
    input: `{ "price": 19.9, "quantity": 3, "taxRate": 0.2 }`,
  },
  outro:
    'This example is **intentionally broken** — `+` never coerces:\n\n```typeflow\ninput order: { id: number }\n\nmap {\n  label: "Order #" + order.id,\n}\n```\n\nMixed-type formatting goes through an explicit conversion — `"Order #" + string(order.id)` — or stays in your host language.\n\nNext: [Comparisons](/operators/comparisons).',
};
