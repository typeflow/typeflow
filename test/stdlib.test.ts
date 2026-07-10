import { describe, expect, test } from 'bun:test';
import { compile } from 'typeflow-js';
import { createMapping } from 'typeflow-js';
import { typeToString } from 'typeflow-js';

function run(expr: string, input: unknown = {}, inputDecl = ''): unknown {
  const source = `${inputDecl}\nmap { v: ${expr} }`;
  const result = compile(source);
  const errs = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errs).toEqual([]);
  const out = createMapping(result.compiled!)(input) as { v: unknown };
  return out.v;
}

function inferred(expr: string, inputDecl = ''): string {
  const result = compile(`${inputDecl}\nmap { v: ${expr} }`);
  const t = result.outputType;
  if (t?.kind !== 'object') return 'unknown';
  return typeToString(t.fields[0]!.type);
}

describe('stdlib: strings', () => {
  test('string / length / case', () => {
    expect(run(`string(42)`)).toBe('42');
    expect(run(`string({ a: 1 })`)).toBe('{"a":1}');
    expect(run(`length("héllo")`)).toBe(5);
    expect(run(`upper("abc")`)).toBe('ABC');
    expect(run(`lower("ABC")`)).toBe('abc');
    expect(run(`trim("  x  ")`)).toBe('x');
  });

  test('substring family', () => {
    expect(run(`substring("Hello World", 6)`)).toBe('World');
    expect(run(`substring("Hello World", 0, 5)`)).toBe('Hello');
    expect(run(`substring("Hello", -3, 2)`)).toBe('ll');
    expect(run(`split("a=b", "=")[0] ?? ""`)).toBe('a');
    expect(run(`split("a=b", "=")[1] ?? ""`)).toBe('b');
  });

  test('pad / contains / matches / split / replace', () => {
    expect(run(`pad("5", 3, "0")`)).toBe('500');
    expect(run(`pad("5", -3, "0")`)).toBe('005');
    expect(run(`contains("abcdef", "cde")`)).toBe(true);
    expect(run(`matches("2026-07-02", "^\\\\d{4}-")`)).toBe(true);
    expect(run(`split("a,b,c", ",")`)).toEqual(['a', 'b', 'c']);
    expect(run(`split("a,b,c", ",", 2)`)).toEqual(['a', 'b']);
    expect(run(`replace("a-b-c", "-", "_")`)).toBe('a_b_c');
  });

  test('base64 and url round-trips', () => {
    expect(run(`base64decode(base64encode("héllo"))`)).toBe('héllo');
    expect(run(`decodeUrlComponent(encodeUrlComponent("a b&c"))`)).toBe(
      'a b&c',
    );
  });
});

describe('stdlib: numbers & aggregation', () => {
  test('number conversion', () => {
    expect(run(`number("42.5")`)).toBe(42.5);
    expect(run(`number(true)`)).toBe(1);
  });

  test('rounding is half-to-even like JSONata', () => {
    expect(run(`round(2.5)`)).toBe(2);
    expect(run(`round(3.5)`)).toBe(4);
    expect(run(`round(4.525, 2)`)).toBe(4.53);
  });

  test('math', () => {
    expect(run(`abs(0 - 5)`)).toBe(5);
    expect(run(`floor(3.7)`)).toBe(3);
    expect(run(`ceil(3.2)`)).toBe(4);
    expect(run(`power(2, 10)`)).toBe(1024);
    expect(run(`sqrt(81)`)).toBe(9);
    expect(run(`formatBase(255, 16)`)).toBe('ff');
  });

  test('aggregates', () => {
    const decl = `input d: { xs: number[] }`;
    const input = { xs: [3, 1, 2] };
    expect(run(`max(d.xs)`, input, decl)).toBe(3);
    expect(run(`min(d.xs)`, input, decl)).toBe(1);
    expect(run(`average(d.xs)`, input, decl)).toBe(2);
  });
});

describe('stdlib: booleans', () => {
  test('JSONata truthiness', () => {
    expect(run(`boolean("")`)).toBe(false);
    expect(run(`boolean("x")`)).toBe(true);
    expect(run(`boolean(0)`)).toBe(false);
    expect(run(`boolean([])`)).toBe(false);
    expect(run(`not(0)`)).toBe(true);
    expect(run(`exists(null)`)).toBe(true);
  });
});

describe('stdlib: arrays', () => {
  const decl = `input d: { xs: number[], ss: string[] }`;
  const input = { xs: [3, 1, 2, 1], ss: ['b', 'a'] };

  test('append / sort / reverse / distinct / zip', () => {
    expect(run(`append(d.ss, d.ss)`, input, decl)).toEqual([
      'b',
      'a',
      'b',
      'a',
    ]);
    expect(run(`sort(d.xs)`, input, decl)).toEqual([1, 1, 2, 3]);
    expect(run(`sort(d.ss)`, input, decl)).toEqual(['a', 'b']);
    expect(run(`reverse(d.ss)`, input, decl)).toEqual(['a', 'b']);
    expect(run(`distinct(d.xs)`, input, decl)).toEqual([3, 1, 2]);
    expect(run(`zip(d.ss, d.xs)`, input, decl)).toEqual([
      ['b', 3],
      ['a', 1],
    ]);
  });

  test('sort/reverse/distinct preserve the input type', () => {
    expect(inferred(`sort(d.xs)`, decl)).toBe('number[]');
    expect(inferred(`distinct(d.ss)`, decl)).toBe('string[]');
    expect(inferred(`append(d.ss, d.xs)`, decl)).toBe('(string | number)[]');
  });

  test('join has an optional separator', () => {
    expect(run(`join(d.ss)`, input, decl)).toBe('ba');
    expect(run(`join(d.ss, "-")`, input, decl)).toBe('b-a');
  });
});

describe('stdlib: objects', () => {
  const decl = `input d: { user: { name: string, age: number } }`;
  const input = { user: { name: 'Ada', age: 36 } };

  test('keys / values / lookup / merge / spread / type', () => {
    expect(run(`keys(d.user)`, input, decl)).toEqual(['name', 'age']);
    expect(run(`values(d.user)`, input, decl)).toEqual(['Ada', 36]);
    expect(run(`lookup(d.user, "name")`, input, decl)).toBe('Ada');
    expect(run(`merge([{ a: 1 }, { b: 2 }])`)).toEqual({ a: 1, b: 2 });
    expect(run(`spread(d.user)`, input, decl)).toEqual([
      { name: 'Ada' },
      { age: 36 },
    ]);
    expect(run(`type(d.user)`, input, decl)).toBe('object');
    expect(run(`type(null)`)).toBe('null');
  });

  test('lookup infers the union of field types and makes the output field optional', () => {
    expect(inferred(`lookup(d.user, "name")`, decl)).toBe('string | number');
    const result = compile(`${decl}\nmap { v: lookup(d.user, "name") }`);
    expect(result.outputType!.kind).toBe('object');
    expect(
      (result.outputType as { fields: { optional: boolean }[] }).fields[0]!
        .optional,
    ).toBe(true);
  });
});

describe('stdlib: date & time', () => {
  test('now / millis / conversions', () => {
    expect(run(`toMillis(fromMillis(0))`)).toBe(0);
    expect(run(`fromMillis(0)`)).toBe('1970-01-01T00:00:00.000Z');
    expect(typeof run(`millis()`)).toBe('number');
    expect(typeof run(`now()`)).toBe('string');
  });
});

describe('stdlib: typing', () => {
  test('wrong argument types are compile errors', () => {
    const bad = compile(`input d: { s: string }\nmap { v: sum(d.s) }`);
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2008');
    const bad2 = compile(`map { v: substring(42, 0) }`);
    expect(bad2.diagnostics.map((d) => d.code)).toContain('TF2008');
  });

  test('optional builtin parameters', () => {
    const ok = compile(`map { a: round(2.567, 2), b: round(2.5) }`);
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const bad = compile(`map { a: round() }`);
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2008');
  });
});
