import { describe, expect, test } from 'bun:test';
import { compile } from '../src/compiler/index';
import { createMapping } from '../src/index';

function run(source: string, input: unknown): unknown {
  const result = compile(source);
  const errs = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errs).toEqual([]);
  return createMapping(result.compiled!)(input);
}

describe('runtime', () => {
  test('executes a full mapping', () => {
    const out = run(
      `input u: { first: string, last: string, tags: { name: string, on: boolean }[], scores: number[], c?: { e?: string } }
       map {
         full: u.first + " " + u.last,
         email: u.c?.e ?? "unknown",
         onTags: u.tags[on].name,
         firstTag: u.tags[0],
         views: u.tags -> { label: upper(name) },
         n: count(u.tags),
         total: sum(u.scores),
         joined: join(u.tags.name, ", "),
       }`,
      {
        first: 'Ada',
        last: 'Lovelace',
        tags: [
          { name: 'a', on: true },
          { name: 'b', on: false },
          { name: 'c', on: true },
        ],
        scores: [1, 2, 3],
      },
    );
    expect(out).toEqual({
      full: 'Ada Lovelace',
      email: 'unknown',
      onTags: ['a', 'c'],
      firstTag: { name: 'a', on: true },
      views: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      n: 3,
      total: 6,
      joined: 'a, b, c',
    });
  });

  test('conditionals and comparisons', () => {
    const out = run(
      `input u: { n: number }\nmap { size: u.n > 10 ? "big" : "small", eq: u.n == 5 }`,
      { n: 5 },
    );
    expect(out).toEqual({ size: 'small', eq: true });
  });

  test('missing optional paths yield undefined, defaults apply', () => {
    const out = run(
      `input u: { c?: { e?: string } }\nmap { raw: u.c?.e, safe: u.c?.e ?? "d" }`,
      {},
    ) as Record<string, unknown>;
    expect(out.raw).toBeUndefined();
    expect(out.safe).toBe('d');
  });

  test('does not read inherited properties', () => {
    const out = run(
      `input u: { toString?: string }\nmap { v: u.toString ?? "clean" }`,
      {},
    ) as Record<string, unknown>;
    expect(out.v).toBe('clean');
  });

  test('is deterministic across calls', () => {
    const result = compile(
      `input u: { xs: number[] }\nmap { total: sum(u.xs), n: count(u.xs) }`,
    );
    const fn = createMapping(result.compiled!);
    const input = { xs: [3, 1, 2] };
    expect(JSON.stringify(fn(input))).toBe(JSON.stringify(fn(input)));
  });

  test('compiled mappings survive JSON round-trips', () => {
    const result = compile(
      `input u: { name: string }\nmap { n: upper(u.name) }`,
    );
    const revived = JSON.parse(JSON.stringify(result.compiled));
    expect(createMapping(revived)({ name: 'ada' })).toEqual({ n: 'ADA' });
  });

  test('calls external functions provided via options', () => {
    const result = compile(`use twice(n: number): number from "./h"
map { a: twice(21) }`);
    const fn = createMapping(result.compiled!, {
      functions: { twice: (n) => (n as number) * 2 },
    });
    expect(fn({})).toEqual({ a: 42 });
  });

  test('fails fast when an external function is missing', () => {
    const result = compile(`use twice(n: number): number from "./h"
map { a: twice(21) }`);
    expect(() => createMapping(result.compiled!)).toThrow(/twice/);
  });

  test('external functions win over scope, not builtins with different names', () => {
    const result = compile(
      `input u: { xs: number[] }
use double(items: number[]): number[] from "./h"
map { d: double(u.xs), s: sum(u.xs) }`,
    );
    const fn = createMapping(result.compiled!, {
      functions: { double: (xs) => (xs as number[]).map((x) => x * 2) },
    });
    expect(fn({ xs: [1, 2] })).toEqual({ d: [2, 4], s: 3 });
  });

  test('modulo operator', () => {
    const out = run(
      `input u: { n: number }
map { r: u.n % 3, even: u.n % 2 == 0 }`,
      {
        n: 10,
      },
    );
    expect(out).toEqual({ r: 1, even: true });
  });

  test('modulo rejects non-numbers', () => {
    const result = compile(`input u: { s: string }
map { r: u.s % 2 }`);
    expect(result.diagnostics.map((d) => d.code)).toContain('TF2004');
  });

  test('projection binder aliases each element', () => {
    const out = run(
      `input u: { labels: { name: string, active: boolean }[] }
map {
  views: u.labels -> l { label: upper(l.name), active: l.active, self: $ },
}`,
      {
        labels: [
          { name: 'a', active: true },
          { name: 'b', active: false },
        ],
      },
    );
    expect(out).toEqual({
      views: [
        { label: 'A', active: true, self: { name: 'a', active: true } },
        { label: 'B', active: false, self: { name: 'b', active: false } },
      ],
    });
  });

  test('sorts an array of objects by a key, ascending and descending', () => {
    const input = {
      orders: [
        { id: 1, total: 30 },
        { id: 2, total: 10 },
        { id: 3, total: 20 },
      ],
    };
    const out = run(
      `input u: { orders: { id: number, total: number }[] }
map {
  asc: u.orders ^(total) -> { id: id },
  desc: u.orders ^(>total) -> { id: id },
}`,
      input,
    );
    expect(out).toEqual({
      asc: [{ id: 2 }, { id: 3 }, { id: 1 }],
      desc: [{ id: 1 }, { id: 3 }, { id: 2 }],
    });
  });

  test('sorts by multiple keys and is stable on ties', () => {
    const out = run(
      `input u: { rows: { p: number, label: string, id: number }[] }
map { out: u.rows ^(>p, label) -> { id: id } }`,
      {
        rows: [
          { p: 1, label: 'b', id: 1 },
          { p: 2, label: 'a', id: 2 },
          { p: 2, label: 'a', id: 3 },
          { p: 2, label: 'c', id: 4 },
        ],
      },
    );
    // p desc first; within p=2, label asc; equal (p=2,label='a') keep input order.
    expect(out).toEqual({
      out: [{ id: 2 }, { id: 3 }, { id: 4 }, { id: 1 }],
    });
  });

  test('sorts with a computed key and pushes nullish keys last', () => {
    const out = run(
      `input u: { rows: { name?: string, id: number }[] }
map { out: u.rows ^(name) -> { id: id } }`,
      {
        rows: [{ name: 'b', id: 1 }, { id: 2 }, { name: 'a', id: 3 }],
      },
    );
    expect(out).toEqual({ out: [{ id: 3 }, { id: 1 }, { id: 2 }] });
  });

  test('let bindings name subexpressions and are reused', () => {
    const out = run(
      `input u: { price: number }
map {
  let base = u.price,
  let tax = base * 0.2,
  price: base,
  total: base + tax,
}`,
      { price: 100 },
    );
    expect(out).toEqual({ price: 100, total: 120 });
  });

  test('a let is scoped to its block, including nested projections', () => {
    const out = run(
      `input u: { labels: { name: string }[] }
map {
  views: u.labels -> {
    let up = upper(name),
    label: up,
    slug: lower(up),
  },
}`,
      { labels: [{ name: 'aB' }] },
    );
    expect(out).toEqual({ views: [{ label: 'AB', slug: 'ab' }] });
  });

  test('projection index binder gives the 0-based position', () => {
    const out = run(
      `input u: { items: { name: string }[] }
map {
  rows: u.items -> item, i { pos: i + 1, name: item.name },
}`,
      { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    );
    expect(out).toEqual({
      rows: [
        { pos: 1, name: 'a' },
        { pos: 2, name: 'b' },
        { pos: 3, name: 'c' },
      ],
    });
  });

  test('$root reaches the input through a shadowing field', () => {
    const out = run(
      `input u: { tag: string, labels: { u: string }[] }
map { out: u.labels -> { field: u, root: $root.tag } }`,
      { tag: 'ROOT', labels: [{ u: 'FIELD' }] },
    );
    expect(out).toEqual({ out: [{ field: 'FIELD', root: 'ROOT' }] });
  });

  test('$parent at a single level resolves to the input', () => {
    const out = run(
      `input u: { tag: string, xs: { n: string }[] }
map { out: u.xs -> { n: n, up: $parent.tag } }`,
      { tag: 'T', xs: [{ n: 'a' }, { n: 'b' }] },
    );
    expect(out).toEqual({
      out: [
        { n: 'a', up: 'T' },
        { n: 'b', up: 'T' },
      ],
    });
  });

  test('$parent.$parent climbs two enclosing elements', () => {
    const out = run(
      `input u: { as: { k: string, bs: { cs: { n: string }[] }[] }[] }
map {
  out: u.as -> {
    bs: bs -> {
      cs: cs -> {
        n: n,
        k: $parent.$parent.k,
      },
    },
  },
}`,
      { as: [{ k: 'A', bs: [{ cs: [{ n: 'x' }, { n: 'y' }] }] }] },
    );
    expect(out).toEqual({
      out: [
        {
          bs: [
            {
              cs: [
                { n: 'x', k: 'A' },
                { n: 'y', k: 'A' },
              ],
            },
          ],
        },
      ],
    });
  });

  test('$parent reaches the enclosing element when nested', () => {
    const out = run(
      `input u: { groups: { key: string, items: { v: string }[] }[] }
map { out: u.groups -> { items: items -> { v: v, key: $parent.key } } }`,
      {
        groups: [
          { key: 'g1', items: [{ v: 'a' }, { v: 'b' }] },
          { key: 'g2', items: [{ v: 'c' }] },
        ],
      },
    );
    expect(out).toEqual({
      out: [
        {
          items: [
            { v: 'a', key: 'g1' },
            { v: 'b', key: 'g1' },
          ],
        },
        { items: [{ v: 'c', key: 'g2' }] },
      ],
    });
  });
});
