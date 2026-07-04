/**
 * Declarative registry of every diagnostic Typeflow can emit.
 * docs/reference/diagnostics.md is generated from this file, and the
 * generator VERIFIES each entry at build time:
 *   - every `example` must actually emit its `code` when compiled;
 *   - every TF-code found in src/ must be documented here.
 * A drifted entry fails the docs build instead of shipping a stale claim.
 */

export interface DiagnosticDoc {
  /** e.g. `TF2002`. */
  code: string;
  severity: 'error' | 'warning';
  /** Short human title, e.g. "Unknown property". */
  title: string;
  /** Markdown explanation: when it fires and why the rule exists. */
  doc: string;
  /** Markdown: how to fix it. */
  fix?: string;
  /** Live example that triggers the diagnostic — verified at generation time. */
  example: { mapping: string; input: string };
}

export const DIAGNOSTICS: DiagnosticDoc[] = [
  {
    code: 'TF1001',
    severity: 'error',
    title: 'Lexical error',
    doc: 'The source contains text the lexer cannot turn into tokens — most commonly an unterminated string or a character that is not part of the language.',
    fix: 'Close the string (or remove the stray character). The caret points at the exact offset.',
    example: {
      mapping: `input user: { name: string }

map {
  greeting: "hello,
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF1002',
    severity: 'error',
    title: 'Parse error',
    doc: 'The tokens do not form a valid mapping — a missing `:`, an unclosed `{`, a misplaced comma. Parsing stops at the first structural error, so fix it and re-check: later errors may disappear.',
    fix: 'The message says what the parser expected at that position.',
    example: {
      mapping: `input user: { name: string }

map {
  name user.name,
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF2001',
    severity: 'error',
    title: 'Unknown identifier',
    doc: 'A bare name does not resolve to anything in scope: not the input binding, not a projection element field, not a function parameter. Typeflow suggests the closest visible name.',
    fix: 'Check the spelling against the `input` declaration (or the enclosing projection).',
    example: {
      mapping: `input user: { name: string }

map {
  name: usr.name,
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF2002',
    severity: 'error',
    title: 'Unknown property',
    doc: 'The flagship check: a path segment does not exist on the type it is read from. In plain code this typo would be a silent `undefined` in production — here it is a compile error with a "did you mean" suggestion.',
    fix: 'Fix the spelling, or update the input type if the data really has that field.',
    example: {
      mapping: `input user: { email: string, firstName: string }

map {
  mail: user.emial,
}`,
      input: `{ "email": "ada@lovelace.dev", "firstName": "Ada" }`,
    },
  },
  {
    code: 'TF2003',
    severity: 'error',
    title: 'Unsafe access through an optional value',
    doc: 'A path reads through a segment that may be `undefined` or `null` (declared `?:` or nullable) using plain `.`. The same rule protects `->` projections and `[...]` filters/indexing on possibly-nullish targets.',
    fix: 'Use the optional access operator (`?.`), or provide a default first with `??`. A `??` default also *removes* the optionality from the inferred output type.',
    example: {
      mapping: `input user: { contact?: { email: string } }

map {
  email: user.contact.email,
}`,
      input: `{ "contact": { "email": "ada@lovelace.dev" } }`,
    },
  },
  {
    code: 'TF2004',
    severity: 'error',
    title: 'Operator / type mismatch',
    doc: 'An operator received operands it does not accept: `+` on a string and a number (Typeflow never coerces), arithmetic on non-numbers, `!`/`&&`/`||` on non-booleans, a non-boolean `? :` condition, ordering comparisons between mixed types.',
    fix: 'Convert explicitly — `string(user.age)`, `number(raw)` — so the intent is visible in the mapping.',
    example: {
      mapping: `input user: { name: string, age: number }

map {
  label: user.name + user.age,
}`,
      input: `{ "name": "Ada", "age": 36 }`,
    },
  },
  {
    code: 'TF2005',
    severity: 'error',
    title: 'Filter or index on a non-array',
    doc: 'The `[...]` operator (filtering with a predicate, or indexing with a number) was applied to something that is not an array.',
    fix: 'Check the path — the segment before `[` must be an array of the input type.',
    example: {
      mapping: `input user: { name: string }

map {
  first: user.name[0],
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF2006',
    severity: 'error',
    title: 'Invalid property access or projection target',
    doc: 'A property was read on a scalar (`number`, `string`, `boolean`), or a `->` projection was applied to something that is not an object or an array of objects.',
    fix: 'Follow the inferred type of the left-hand side — the message shows exactly what type the access was attempted on.',
    example: {
      mapping: `input user: { age: number }

map {
  city: user.age.city,
}`,
      input: `{ "age": 36 }`,
    },
  },
  {
    code: 'TF2007',
    severity: 'error',
    title: 'Unknown function',
    doc: 'A call names a function that is neither a [builtin](/functions/), an [`fn` definition](/functions/custom), a [`use` declaration](/functions/custom#use), nor a registered [`defineFunction`](/functions/custom). The hint lists everything that *is* available.',
    fix: 'Pick from the hint list, or declare the function (`fn`, `use`, or `defineFunction`).',
    example: {
      mapping: `input user: { name: string }

map {
  name: capitalizeWords(user.name),
}`,
      input: `{ "name": "ada lovelace" }`,
    },
  },
  {
    code: 'TF2008',
    severity: 'error',
    title: 'Wrong function arguments',
    doc: 'A function was called with the wrong number of arguments, or an argument whose type does not match the parameter. The hint restates the full signature. Applies to builtins and to your own `fn` / `use` / `defineFunction` functions alike.',
    fix: 'Match the signature — convert arguments explicitly when needed (`upper(string(user.age))`).',
    example: {
      mapping: `input user: { age: number }

map {
  shout: upper(user.age),
}`,
      input: `{ "age": 36 }`,
    },
  },
  {
    code: 'TF2009',
    severity: 'error',
    title: 'Non-boolean filter predicate',
    doc: 'The expression inside a `[...]` filter must be a boolean. Bare identifiers inside a filter resolve on the *element*, so `labels[active]` works when `active` is a boolean field — but `labels[name]` is a string, not a predicate.',
    fix: 'Write a real condition: `labels[name == "core"]`.',
    example: {
      mapping: `input user: { labels: { name: string, active: boolean }[] }

map {
  named: user.labels[name],
}`,
      input: `{ "labels": [{ "name": "core", "active": true }] }`,
    },
  },
  {
    code: 'TF2010',
    severity: 'error',
    title: 'Input type could not be resolved',
    doc: 'An `input x: T from "./module"` declaration could not be resolved: no schema adapter is configured, the module does not exist, or it does not export that type. (The playground cannot import files — this example shows the diagnostic itself; in a project the TypeScript adapter resolves the type through the compiler API.)',
    fix: 'Check the module path and the exported type name — or use an inline structural type.',
    example: {
      mapping: `input user: ApiUser from "./user-types"

map {
  id: user.id,
}`,
      input: `{ "id": 1 }`,
    },
  },
  {
    code: 'TF2011',
    severity: 'error',
    title: 'Invalid sort key',
    doc: 'A `^(...)` sort key must evaluate to a `number` or a `string` — booleans, objects and arrays have no meaningful order. Nullish keys are fine: the runtime sorts them last.',
    fix: 'Sort on a scalar field, or derive one — `^(length(name))`.',
    example: {
      mapping: `input user: { labels: { name: string, active: boolean }[] }

map {
  sorted: user.labels^(active).name,
}`,
      input: `{ "labels": [{ "name": "core", "active": true }] }`,
    },
  },
  {
    code: 'TF2012',
    severity: 'error',
    title: "Property access on 'unknown'",
    doc: 'A value typed `unknown` cannot be dereferenced — unlike `any`, `unknown` means "I promise nothing about this shape", and Typeflow holds you to it.',
    fix: 'Narrow the type in the input declaration, or pass the value through as-is.',
    example: {
      mapping: `input user: { data: unknown }

map {
  name: user.data.name,
}`,
      input: `{ "data": { "name": "Ada" } }`,
    },
  },
  {
    code: 'TF2013',
    severity: 'warning',
    title: "Useless '??' (never nullish)",
    doc: "The left side of `??` can never be `null` or `undefined`, so the fallback is dead code. Often a leftover after an input type gained a required field — the compiler flags it so mappings don't accumulate cruft.",
    fix: 'Remove the `?? default`, or make the input field optional if it really can be absent.',
    example: {
      mapping: `input user: { name: string }

map {
  name: user.name ?? "anonymous",
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF2014',
    severity: 'error',
    title: 'Duplicate property',
    doc: 'The same key appears twice in an object body. JSON would silently keep the last one — Typeflow refuses the ambiguity.',
    fix: 'Remove or rename one of the two.',
    example: {
      mapping: `input user: { name: string }

map {
  name: user.name,
  name: upper(user.name),
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF2015',
    severity: 'warning',
    title: "No 'input' declaration",
    doc: 'Without an `input` declaration the input is typed `any`: the mapping still runs, but paths cannot be validated — you lose the entire point of the language.',
    fix: 'Bind the input: `input user: T from "./module"`, or an inline structural type.',
    example: {
      mapping: `map {
  answer: 42,
}`,
      input: `{}`,
    },
  },
  {
    code: 'TF2016',
    severity: 'error',
    title: 'Function name conflict',
    doc: 'An `fn` definition, `use` declaration, or registered function has the same name as a builtin or another function. One name, one meaning — shadowing builtins would make mappings mean different things in different projects.',
    fix: 'Rename your function.',
    example: {
      mapping: `input user: { name: string }

fn upper(v: string): string = v

map {
  name: upper(user.name),
}`,
      input: `{ "name": "Ada" }`,
    },
  },
  {
    code: 'TF2017',
    severity: 'error',
    title: "'fn' return type mismatch",
    doc: 'An `fn` declares a return type, but its body evaluates to something not assignable to it. The declared type is a contract — the body must satisfy it.',
    fix: 'Fix the body, or fix (or drop) the declared return type — it is optional and inferred from the body.',
    example: {
      mapping: `input user: { score: number }

fn label(n: number): string = n * 2

map {
  label: label(user.score),
}`,
      input: `{ "score": 21 }`,
    },
  },
  {
    code: 'TF2018',
    severity: 'error',
    title: 'Duplicate binding',
    doc: 'Two `let` bindings in the same object block share a name. A binding sees only the bindings declared before it, so redefining a name in the same block is ambiguous — Typeflow refuses it.',
    fix: 'Rename one of the bindings.',
    example: {
      mapping: `input user: { first: string, last: string }

map {
  let full = user.first + " " + user.last,
  let full = user.last,
  name: full,
}`,
      input: `{ "first": "Ada", "last": "Lovelace" }`,
    },
  },
  {
    code: 'TF2367',
    severity: 'warning',
    title: 'Comparison without overlap',
    doc: 'The two sides of a comparison have types that can never be equal — a `number` compared against a `string`, for instance. The comparison is legal but always `false`, which is almost always a bug: Typeflow never coerces, so `age == "36"` does not do what it would in JavaScript. (Same number as TypeScript\'s TS2367, on purpose.)',
    fix: 'Compare against the right type — `user.age == 36` — or convert explicitly with `string()` / `number()`.',
    example: {
      mapping: `input user: { age: number }

map {
  isAdult: user.age == "18",
}`,
      input: `{ "age": 36 }`,
    },
  },
];
