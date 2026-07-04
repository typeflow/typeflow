import { describe, expect, test } from 'bun:test';
import { compile } from '../src/compiler/index';
import { createMapping } from '../src/runtime/index';
import { format } from '../src/formatter/index';

function run(source: string, input: unknown): unknown {
  const result = compile(source);
  const errs = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errs).toEqual([]);
  return createMapping(result.compiled!)(input);
}

describe('fn declarations', () => {
  test('defines and calls functions written in typeflow', () => {
    const out = run(
      `input u: { first: string, last: string }
fn fullName(first: string, last: string): string = first + " " + last
map { name: fullName(u.first, u.last) }`,
      { first: 'Ada', last: 'Lovelace' },
    );
    expect(out).toEqual({ name: 'Ada Lovelace' });
  });

  test('return type is inferred when omitted', () => {
    const result = compile(
      `fn grade(score: number) = score >= 10 ? "pass" : "fail"\nmap { g: grade(12) }`,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
    const field = (result.outputType as { fields: { type: unknown }[] })
      .fields[0]!;
    expect(field.type).toEqual({
      kind: 'union',
      types: [
        { kind: 'literal', value: 'pass' },
        { kind: 'literal', value: 'fail' },
      ],
    });
  });

  test('declared return type is checked against the body (TF2017)', () => {
    const bad = compile(`fn f(a: number): string = a + 1\nmap { x: f(1) }`);
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2017');
  });

  test('fns can call earlier fns but not later ones', () => {
    const ok = run(
      `fn double(n: number) = n * 2
fn quad(n: number) = double(double(n))
map { q: quad(3) }`,
      {},
    );
    expect(ok).toEqual({ q: 12 });

    const forward = compile(
      `fn quad(n: number) = double(double(n))\nfn double(n: number) = n * 2\nmap { q: quad(3) }`,
    );
    expect(forward.diagnostics.map((d) => d.code)).toContain('TF2007');
  });

  test('fn bodies are pure: the input binding is not in scope', () => {
    const bad = compile(
      `input u: { x: number }\nfn leak(a: number) = a + u.x\nmap { a: leak(1) }`,
    );
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2001');
  });

  test('argument types are checked at call sites (TF2008)', () => {
    const bad = compile(
      `fn double(n: number) = n * 2\nmap { x: double("nope") }`,
    );
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2008');
  });

  test('name conflicts are TF2016', () => {
    const vsBuiltin = compile(`fn upper(v: string) = v\nmap { a: 1 }`);
    expect(vsBuiltin.diagnostics.map((d) => d.code)).toContain('TF2016');
    const dup = compile(
      `fn f(a: number) = a\nfn f(a: number) = a\nmap { a: f(1) }`,
    );
    expect(dup.diagnostics.map((d) => d.code)).toContain('TF2016');
  });

  test('optional parameters default to undefined', () => {
    const out = run(
      `fn label(name: string, prefix?: string) = (prefix ?? "#") + name
map { a: label("x"), b: label("x", "@") }`,
      {},
    );
    expect(out).toEqual({ a: '#x', b: '@x' });
  });

  test('defs survive JSON serialization of the artifact', () => {
    const result = compile(
      `fn double(n: number) = n * 2\nmap { x: double(21) }`,
    );
    const revived = JSON.parse(JSON.stringify(result.compiled));
    expect(createMapping(revived)({})).toEqual({ x: 42 });
  });

  test('fns can call use-declared and registered functions', () => {
    const result = compile(
      `use tag(v: string): string from "./h"
fn loud(v: string) = upper(tag(v))
map { a: loud("hi") }`,
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
    // the use fn is called from the fn body, so it must be required at runtime
    expect(result.compiled!.functions).toEqual([{ name: 'tag', from: './h' }]);
    const fn = createMapping(result.compiled!, {
      functions: { tag: (v) => `<${v}>` },
    });
    expect(fn({})).toEqual({ a: '<HI>' });
  });

  test('formatter prints fn declarations canonically', () => {
    const messy = `fn add(a:number,b:number):number=a+b\nmap{x:add(1,2)}`;
    const result = format(messy);
    expect(result.ok).toBe(true);
    expect(result.formatted).toBe(
      `fn add(a: number, b: number): number = a + b\n\nmap {\n  x: add(1, 2),\n}\n`,
    );
  });
});
