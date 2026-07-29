import { type DocPage } from '../types';

export const paths: DocPage = {
  id: 'paths',
  title: 'Paths & optionality',
  order: 2,
  intro:
    'A **path** reads a value out of the input: `user.address.city`. Because the input is typed, every segment is validated at compile time — a typo is a compile error, not a silent `undefined`.',
  items: [
    {
      name: '.',
      id: 'path',
      effect: 'read a value out of the input',
      doc: 'Every segment is validated — a typo is `TF2002` with a "did you mean" suggestion, not a silent `undefined`.',
      snippet: `city: user.address.city`,
    },
    {
      name: '?.',
      id: 'optional-chain',
      effect: 'required for optional or nullable segments',
      doc: 'If a segment may be missing (`contact?:`) or nullable, plain `.` access is refused (`TF2003`). Without a default, a possibly-`undefined` value becomes an **optional field** of the output type — the field is simply absent from the output JSON when its value is `undefined`.',
      snippet: `email: user.contact?.email`,
    },
    {
      name: '??',
      id: 'default',
      effect: 'supply a fallback for null/undefined, strips optionality',
      doc: 'The compiler also flags the opposite mistake: using `??` on a value that is never nullish is warning `TF2013` — dead code.',
      snippet: `email: user.contact?.email ?? "unknown"`,
    },
  ],
  playground: {
    mapping: `input user: {
  name: string,
  contact?: { email?: string },
}

map {
  name: user.name,
  email: user.contact?.email ?? "unknown",
}`,
    input: `{ "name": "Ada", "contact": {} }`,
  },
  outro: 'Next: [Arithmetic & strings](/operators/arithmetic).',
};
