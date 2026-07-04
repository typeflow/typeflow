import { describe, expect, test } from 'bun:test';
import { compile } from '../src/index';
import { typeToString } from '../src/core/index';

function errors(source: string) {
  return compile(source).diagnostics.filter((d) => d.severity === 'error');
}

function output(source: string): string {
  const result = compile(source);
  const errs = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errs).toEqual([]);
  return typeToString(result.outputType!);
}

describe('path validation', () => {
  test('flags a typo with a suggestion', () => {
    const errs = errors(`input u: { email: string }\nmap { a: u.emial }`);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.code).toBe('TF2002');
    expect(errs[0]!.message).toContain("Did you mean 'email'?");
  });

  test('flags unknown root identifiers with a suggestion', () => {
    const errs = errors(`input user: { id: number }\nmap { a: usr.id }`);
    expect(errs[0]!.code).toBe('TF2001');
    expect(errs[0]!.message).toContain("Did you mean 'user'?");
  });

  test('flags unsafe access through an optional field', () => {
    const errs = errors(`input u: { c?: { e: string } }\nmap { a: u.c.e }`);
    expect(errs[0]!.code).toBe('TF2003');
    expect(errs[0]!.hint).toContain('?.');
  });

  test('accepts optional chaining', () => {
    expect(errors(`input u: { c?: { e: string } }\nmap { a: u.c?.e }`)).toEqual(
      [],
    );
  });
});

describe('output inference', () => {
  test('infers primitives and optionality', () => {
    const t = output(
      `input u: { id: number, c?: { e?: string } }\nmap { id: u.id, e: u.c?.e }`,
    );
    expect(t).toContain('id: number');
    expect(t).toContain('e?: string');
  });

  test('coalescing removes optionality', () => {
    const t = output(
      `input u: { c?: { e?: string } }\nmap { e: u.c?.e ?? "x" }`,
    );
    expect(t).toContain('e: string');
    expect(t).not.toContain('e?:');
  });

  test('filters keep the array type, indexing yields element | undefined', () => {
    const t = output(
      `input u: { tags: { name: string, on: boolean }[] }\nmap { a: u.tags[on], b: u.tags[0] }`,
    );
    expect(t).toContain('a: { name: string; on: boolean }[]');
    expect(t).toContain('b?: { name: string; on: boolean }');
  });

  test('path access distributes over arrays', () => {
    const t = output(
      `input u: { tags: { name: string }[] }\nmap { names: u.tags.name }`,
    );
    expect(t).toContain('names: string[]');
  });

  test('projection maps each element', () => {
    const t = output(
      `input u: { tags: { name: string, on: boolean }[] }\nmap { v: u.tags -> { n: upper(name) } }`,
    );
    expect(t).toContain('v: { n: string }[]');
  });

  test('sort keeps the array type', () => {
    const t = output(
      `input u: { rows: { id: number, name: string }[] }\nmap { a: u.rows ^(name) }`,
    );
    expect(t).toContain('a: { id: number; name: string }[]');
  });

  test('sort accepts multiple keys with directions', () => {
    expect(
      errors(
        `input u: { rows: { p: number, n: string }[] }\nmap { a: u.rows ^(>p, n) }`,
      ),
    ).toEqual([]);
  });

  test('rejects a non-comparable sort key', () => {
    const errs = errors(
      `input u: { rows: { flag: boolean }[] }\nmap { a: u.rows ^(flag) }`,
    );
    expect(errs[0]!.code).toBe('TF2011');
  });

  test('rejects sorting a non-array', () => {
    const errs = errors(`input u: { n: number }\nmap { a: u.n ^(n) }`);
    expect(errs[0]!.code).toBe('TF2005');
  });

  test('let bindings are typed and usable by properties', () => {
    const t = output(
      `input u: { price: number }\nmap { let net = u.price * 2, total: net }`,
    );
    expect(t).toContain('total: number');
  });

  test('rejects a forward reference between let bindings', () => {
    const errs = errors(
      `input u: { x: number }\nmap { let a = b, let b = u.x, v: a }`,
    );
    expect(errs[0]!.code).toBe('TF2001');
  });

  test('rejects a duplicate let binding', () => {
    const errs = errors(
      `input u: { x: number }\nmap { let a = u.x, let a = 2, v: a }`,
    );
    expect(errs.some((e) => e.code === 'TF2018')).toBe(true);
  });

  test('$parent.$parent is typed from the grandparent element', () => {
    const t = output(
      `input u: { as: { k: string, bs: { cs: { n: string }[] }[] }[] }
map { out: u.as -> { bs: bs -> { cs: cs -> { n: n, k: $parent.$parent.k } } } }`,
    );
    expect(t).toContain('k: string');
  });

  test('projection index binder is typed as a number', () => {
    const t = output(
      `input u: { xs: { n: string }[] }\nmap { v: u.xs -> el, i { pos: i + 1 } }`,
    );
    expect(t).toContain('pos: number');
  });

  test('literals survive as literal types', () => {
    const t = output(`input u: { id: number }\nmap { kind: "user", n: u.id }`);
    expect(t).toContain(`kind: "user"`);
  });

  test('conditionals produce unions', () => {
    const t = output(
      `input u: { n: number }\nmap { s: u.n > 2 ? "big" : "small" }`,
    );
    expect(t).toContain(`"big" | "small"`);
  });
});

describe('operators and functions', () => {
  test('rejects mixed-type addition', () => {
    const errs = errors(
      `input u: { id: number, name: string }\nmap { a: u.id + u.name }`,
    );
    expect(errs[0]!.code).toBe('TF2004');
  });

  test('warns on comparisons without overlap', () => {
    const result = compile(`input u: { id: number }\nmap { a: u.id == "x" }`);
    const warning = result.diagnostics.find((d) => d.code === 'TF2367');
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
  });

  test('flags unknown functions with a suggestion', () => {
    const errs = errors(`input u: { name: string }\nmap { a: uppr(u.name) }`);
    expect(errs[0]!.code).toBe('TF2007');
    expect(errs[0]!.message).toContain("Did you mean 'upper'?");
  });

  test('checks builtin argument types', () => {
    const errs = errors(`input u: { name: string }\nmap { a: sum(u.name) }`);
    expect(errs[0]!.code).toBe('TF2008');
  });

  test('warns on useless coalescing', () => {
    const result = compile(
      `input u: { name: string }\nmap { a: u.name ?? "x" }`,
    );
    expect(result.diagnostics.find((d) => d.code === 'TF2013')).toBeDefined();
  });
});

describe('input handling', () => {
  test('missing input declaration types input as any with a warning', () => {
    const result = compile(`map { a: input.whatever }`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.find((d) => d.code === 'TF2015')).toBeDefined();
  });

  test('missing resolver for a type reference is an error', () => {
    const errs = errors(`input u: User from "./types"\nmap { a: u.x }`);
    expect(errs[0]!.code).toBe('TF2010');
  });

  test('checks calls to use-declared functions', () => {
    const result = compile(
      `input u: { name: string }
use slugify(value: string): string from "./helpers"
map { s: slugify(u.name) }`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.outputType).toEqual({
      kind: 'object',
      fields: [{ name: 's', type: { kind: 'string' }, optional: false }],
    });
    expect(result.compiled!.functions).toEqual([
      { name: 'slugify', from: './helpers' },
    ]);
  });

  test('rejects bad arguments to use-declared functions', () => {
    const result = compile(
      `input u: { n: number }
use slugify(value: string): string from "./helpers"
map { s: slugify(u.n) }`,
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('TF2008');
  });

  test('supports optional parameters in use declarations', () => {
    const ok =
      compile(`use pick(items: string[], n?: number): string[] from "./h"
map { a: pick(["x"]), b: pick(["x"], 1) }`);
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const bad =
      compile(`use pick(items: string[], n?: number): string[] from "./h"
map { a: pick() }`);
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2008');
  });

  test('rejects use declarations that shadow builtins or repeat', () => {
    const result = compile(`use upper(v: string): string from "./h"
use f(v: string): string from "./h"
use f(v: string): string from "./h"
map { a: 1 }`);
    expect(result.diagnostics.filter((d) => d.code === 'TF2016')).toHaveLength(
      2,
    );
  });
});
