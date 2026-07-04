import { describe, expect, test } from 'bun:test';
import { compile } from '../src/compiler/index';
import { convertJsonata } from '../src/converter';
import { createMapping } from '../src/runtime/index';
import { MIGRATION_EXAMPLES } from '../src/converter/examples';

/** Convert, compile with an input declaration, and run against real data. */
function convertAndRun(
  jsonata: string,
  inputType: string,
  input: unknown,
): unknown {
  const converted = convertJsonata(jsonata, { input: 'none' });
  expect(converted.errors).toEqual([]);
  const source = `input data: ${inputType}\n\n${converted.typeflow}`;
  const result = compile(source);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return createMapping(result.compiled!)(input);
}

describe('convertJsonata', () => {
  test('reshapes objects and rewrites & concatenation with string()', () => {
    const out = convertAndRun(
      `{ "fullName": firstName & " " & lastName, "ref": "user-" & id }`,
      '{ firstName: string, lastName: string, id: number }',
      { firstName: 'Ada', lastName: 'Lovelace', id: 42 },
    );
    expect(out).toEqual({ fullName: 'Ada Lovelace', ref: 'user-42' });
  });

  test('translates predicates, paths, and stdlib calls', () => {
    const out = convertAndRun(
      `{ "names": products[price > 100].name, "total": $sum(products.price) }`,
      '{ products: { name: string, price: number }[] }',
      {
        products: [
          { name: 'a', price: 120 },
          { name: 'b', price: 9 },
        ],
      },
    );
    expect(out).toEqual({ names: ['a'], total: 129 });
  });

  test('turns $filter/$map lambdas into [predicate] and -> projection', () => {
    const converted = convertJsonata(
      `{ "top": $filter(items, function($v) { $v.score > 10 }), "views": $map(items, function($v) { { "label": $uppercase($v.name) } }) }`,
    );
    expect(converted.ok).toBe(true);
    expect(converted.typeflow).toContain('data.items[score > 10]');
    // The $map lambda param becomes a `->` alias, referenced through its name.
    expect(converted.typeflow).toContain(
      'data.items -> $v { label: upper($v.name) }',
    );
  });

  test('turns arr.{ ... } into a projection', () => {
    const converted = convertJsonata(
      `{ "orders": orders.{ "id": id, "total": price * quantity } }`,
    );
    expect(converted.ok).toBe(true);
    expect(converted.typeflow).toContain(
      'data.orders -> { id: id, total: price * quantity }',
    );
  });

  test('wraps non-object roots in a value field with a note', () => {
    const converted = convertJsonata(`$sum(items.price)`);
    expect(converted.ok).toBe(true);
    expect(converted.typeflow).toContain('value: sum(data.items.price)');
    expect(converted.notes.length).toBeGreaterThan(0);
  });

  test('respects a custom input binding name', () => {
    const converted = convertJsonata(`{ "n": $count(items) }`, {
      inputName: 'payload',
    });
    expect(converted.typeflow).toContain('count(payload.items)');
  });

  test('translates ^(...) order-by, keeping key direction and element scope', () => {
    const converted = convertJsonata(`orders^(>total, name)`, {
      input: 'none',
    });
    expect(converted.errors).toEqual([]);
    expect(converted.typeflow).toContain('data.orders ^(>total, name)');

    const out = convertAndRun(
      `orders^(>total, name).{ "id": id }`,
      '{ orders: { id: number, total: number, name: string }[] }',
      {
        orders: [
          { id: 1, total: 30, name: 'b' },
          { id: 2, total: 30, name: 'a' },
          { id: 3, total: 50, name: 'c' },
        ],
      },
    );
    // total desc, then name asc; the 30-tie orders by name (a before b).
    expect(out).toEqual({ value: [{ id: 3 }, { id: 2 }, { id: 1 }] });
  });

  test('drops a redundant ascending marker (`<` is the default)', () => {
    const converted = convertJsonata(`items^(<price)`, { input: 'none' });
    expect(converted.errors).toEqual([]);
    expect(converted.typeflow).toContain('data.items ^(price)');
  });

  test('converts a .( ... ) per-element block with an index binding', () => {
    const converted = convertJsonata(
      `offers[Result >= $$.threshold]#$i.( { "n": $i + 1, "id": $.Id } )`,
      { input: 'none' },
    );
    expect(converted.errors).toEqual([]);
    expect(converted.typeflow).toContain(
      'data.offers[Result >= $root.threshold] -> _, $i',
    );

    const out = convertAndRun(
      `offers[score >= $$.threshold]#$i.( { "rank": $i + 1, "id": $.Id } )`,
      '{ threshold: number, offers: { score: number, Id: string }[] }',
      {
        threshold: 5,
        offers: [
          { score: 9, Id: 'a' },
          { score: 2, Id: 'b' },
          { score: 7, Id: 'c' },
        ],
      },
    );
    expect(out).toEqual({
      value: [
        { rank: 1, id: 'a' },
        { rank: 2, id: 'c' },
      ],
    });
  });

  test('reports unsupported constructs instead of guessing', () => {
    for (const src of [
      `{ "x": $each(obj, function($v, $k) { $v }) }`,
      `{ "x": foo@$v.bar }`,
      `( a; b )`,
    ]) {
      const converted = convertJsonata(src);
      expect(converted.ok).toBe(false);
      expect(converted.errors.length).toBeGreaterThan(0);
    }
  });

  test('rewrites `v in list` to a count(...) membership test', () => {
    const converted = convertJsonata(`{ "member": role in roles }`, {
      input: 'none',
    });
    expect(converted.errors).toEqual([]);
    expect(converted.typeflow).toContain(
      'count(data.roles[$ == data.role]) > 0',
    );

    const out = convertAndRun(
      `{ "isAdmin": role in roles, "hasTag": "x" in tags }`,
      '{ role: string, roles: string[], tags: string[] }',
      { role: 'admin', roles: ['user', 'admin'], tags: ['a', 'b'] },
    );
    expect(out).toEqual({ isAdmin: true, hasTag: false });
  });

  test('converts a $var := ... block returning an object into let bindings', () => {
    const converted = convertJsonata(
      `( $base := product.price; $tax := $base * 0.2; { "price": $base, "total": $base + $tax } )`,
      { input: 'none' },
    );
    expect(converted.errors).toEqual([]);
    expect(converted.typeflow).toContain('let $base = data.product.price');
    expect(converted.typeflow).toContain('let $tax = $base * 0.2');

    const out = convertAndRun(
      `( $base := product.price; $tax := $base * 0.2; { "price": $base, "total": $base + $tax } )`,
      '{ product: { price: number } }',
      { product: { price: 100 } },
    );
    expect(out).toEqual({ price: 100, total: 120 });
  });

  test('inlines a $var := ... block that returns a scalar', () => {
    const out = convertAndRun(
      `( $net := price - discount; $net )`,
      '{ price: number, discount: number }',
      { price: 50, discount: 8 },
    );
    expect(out).toEqual({ value: 42 });
  });

  test('every docs migration example converts, compiles, and runs', () => {
    for (const ex of MIGRATION_EXAMPLES) {
      const out = convertAndRun(ex.jsonata, ex.inputType, JSON.parse(ex.input));
      expect(out).toBeDefined();
    }
  });

  test('translates the % operator directly', () => {
    const out = convertAndRun(`{ "odd": n % 2 = 1 }`, '{ n: number }', {
      n: 7,
    });
    expect(out).toEqual({ odd: true });
  });

  test('infers the input declaration from the expression by default', () => {
    const converted = convertJsonata(
      `{ "name": firstName & "!", "top": products[price > 100].name, "total": $sum(products.price) }`,
    );
    expect(converted.ok).toBe(true);
    expect(converted.typeflow).toContain('input data:');
    expect(converted.typeflow).toContain('firstName: string');
    expect(converted.typeflow).toContain('price: number');
    // the inferred mapping must compile without errors
    const check = compile(converted.typeflow);
    expect(check.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  test('derives the input declaration from a sample when provided', () => {
    const converted = convertJsonata(`{ "n": $count(items) }`, {
      input: { sample: { items: [{ id: 1, tag: 'a' }] } },
    });
    expect(converted.typeflow).toContain(
      'input data: { items: { id: number, tag: string }[] }',
    );
  });

  test("input: 'none' emits only the map block", () => {
    const converted = convertJsonata(`{ "n": $count(items) }`, {
      input: 'none',
    });
    expect(converted.typeflow.trimStart().startsWith('map {')).toBe(true);
  });

  test('$map lambda param becomes a -> alias reachable from nested maps', () => {
    const out = convertAndRun(
      '$map(groups, function($g) { { "key": $g.key, "items": $map($g.items, function($i) { { "g": $g.key, "n": $i.name } }) } })',
      '{ groups: { key: string, items: { name: string }[] }[] }',
      {
        groups: [
          { key: 'g1', items: [{ name: 'a' }, { name: 'b' }] },
          { key: 'g2', items: [{ name: 'c' }] },
        ],
      },
    );
    expect(out).toEqual({
      value: [
        {
          key: 'g1',
          items: [
            { g: 'g1', n: 'a' },
            { g: 'g1', n: 'b' },
          ],
        },
        { key: 'g2', items: [{ g: 'g2', n: 'c' }] },
      ],
    });
  });

  test('JSONata % (parent) converts to $parent', () => {
    const converted = convertJsonata('items.{ "n": name, "cat": %.category }', {
      input: 'none',
    });
    expect(converted.typeflow).toContain('cat: $parent.category');
    const out = convertAndRun(
      'items.{ "n": name, "cat": %.category }',
      '{ category: string, items: { name: string }[] }',
      { category: 'books', items: [{ name: 'a' }, { name: 'b' }] },
    );
    expect(out).toEqual({
      value: [
        { n: 'a', cat: 'books' },
        { n: 'b', cat: 'books' },
      ],
    });
  });

  test('JSONata $$ (root) converts to $root', () => {
    const converted = convertJsonata('labels.{ "n": name, "org": $$.org }', {
      input: 'none',
    });
    expect(converted.typeflow).toContain('org: $root.org');
    const out = convertAndRun(
      'labels.{ "n": name, "org": $$.org }',
      '{ org: string, labels: { name: string }[] }',
      { org: 'acme', labels: [{ name: 'x' }] },
    );
    expect(out).toEqual({ value: [{ n: 'x', org: 'acme' }] });
  });

  test('multi-level parent resolves to $root once it reaches the input', () => {
    // Two projections deep, `%.%` reaches past both elements to the input.
    const out = convertAndRun(
      `{ "org": org, "groups": groups.{ "key": key, "items": items.{ "label": name, "org": %.%.org, "grp": %.key } } }`,
      '{ org: string, groups: { key: string, items: { name: string }[] }[] }',
      { org: 'acme', groups: [{ key: 'g1', items: [{ name: 'a' }] }] },
    );
    expect(out).toEqual({
      org: 'acme',
      groups: [{ key: 'g1', items: [{ label: 'a', org: 'acme', grp: 'g1' }] }],
    });
  });

  test('a strictly-intermediate parent (3+ deep) becomes a $parent chain', () => {
    const converted = convertJsonata('a.{ "x": b.{ "y": c.{ "z": %.%.f } } }', {
      input: 'none',
    });
    expect(converted.errors).toEqual([]);
    // From `c`, `%.%` is `b`'s parent's parent — the enclosing `a` element.
    expect(converted.typeflow).toContain('z: $parent.$parent.f');
  });

  test('unknown functions become stub fn mocks that compile', () => {
    const converted = convertJsonata(
      '{ "d": $stringToDate(raw), "n": $noArgs() }',
    );
    expect(converted.ok).toBe(true);
    expect(converted.typeflow).toContain(
      'fn stringToDate(a0: unknown): unknown = a0',
    );
    expect(converted.typeflow).toContain('fn noArgs(): unknown = null');
    expect(converted.typeflow).toContain('d: stringToDate(data.raw)');
    expect(converted.notes.join(' ')).toContain('stub `fn stringToDate`');
    // The generated stubs let the whole mapping type-check.
    const check = compile(converted.typeflow);
    expect(check.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  test('a stub fn uses the widest arity seen across calls', () => {
    const converted = convertJsonata('{ "a": $f(x), "b": $f(x, y, z) }', {
      input: 'none',
    });
    expect(converted.typeflow).toContain(
      'fn f(a0: unknown, a1: unknown, a2: unknown): unknown = a0',
    );
  });
});
