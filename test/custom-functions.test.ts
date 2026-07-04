import { compile, defineFunction } from '../src/compiler/index';
import { describe, expect, test } from 'bun:test';
import { createMapping } from '../src/runtime/index';

const slugify = defineFunction('slugify(value: string): string', {
  doc: 'Lowercase, dash-separated slug.',
  impl: (value) =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
});

const clamp = defineFunction('clamp(n: number, max?: number): number', {
  impl: (n, max) => Math.min(n as number, (max as number | undefined) ?? 100),
});

describe('defineFunction', () => {
  test('parses and renders a canonical signature', () => {
    expect(slugify.name).toBe('slugify');
    expect(slugify.signature).toBe('slugify(value: string): string');
    expect(clamp.signature).toBe('clamp(n: number, max?: number): number');
  });

  test('rejects invalid signatures', () => {
    expect(() => defineFunction('nope(', { impl: () => 1 })).toThrow(
      /Invalid function signature/,
    );
    expect(() =>
      defineFunction('f(a: string): string extra', { impl: () => 1 }),
    ).toThrow(/Invalid function signature/);
  });
});

describe('compile with registered functions', () => {
  test('checks calls like builtins', () => {
    const ok = compile(
      `input u: { name: string }\nmap { slug: slugify(u.name), n: clamp(150) }`,
      { functions: [slugify, clamp] },
    );
    expect(ok.diagnostics).toEqual([]);
    expect(ok.outputType).toEqual({
      kind: 'object',
      fields: [
        { name: 'slug', type: { kind: 'string' }, optional: false },
        { name: 'n', type: { kind: 'number' }, optional: false },
      ],
    });
  });

  test('rejects bad arguments and unknown functions', () => {
    const bad = compile(`input u: { n: number }\nmap { s: slugify(u.n) }`, {
      functions: [slugify],
    });
    expect(bad.diagnostics.map((d) => d.code)).toContain('TF2008');
    const unknown = compile(`map { s: slugify("x") }`);
    expect(unknown.diagnostics.map((d) => d.code)).toContain('TF2007');
  });

  test('records only the called custom functions in the artifact', () => {
    const result = compile(`map { s: slugify("Hello World") }`, {
      functions: [slugify, clamp],
    });
    expect(result.compiled!.functions).toEqual([{ name: 'slugify' }]);
  });

  test('conflicts are TF2016', () => {
    const vsBuiltin = defineFunction('upper(v: string): string', {
      impl: (v) => v,
    });
    const conflict = compile(`map { a: 1 }`, { functions: [vsBuiltin] });
    expect(conflict.diagnostics.map((d) => d.code)).toContain('TF2016');

    const vsUse = compile(
      `use slugify(v: string): string from "./h"\nmap { a: slugify("x") }`,
      { functions: [slugify] },
    );
    expect(vsUse.diagnostics.map((d) => d.code)).toContain('TF2016');
  });
});

describe('runtime with registered functions', () => {
  test('accepts defineFunction results directly', () => {
    const result = compile(`map { s: slugify("Hello World"), n: clamp(150) }`, {
      functions: [slugify, clamp],
    });
    const fn = createMapping(result.compiled!, {
      functions: [slugify, clamp],
    });
    expect(fn({})).toEqual({ s: 'hello-world', n: 100 });
  });

  test('fails fast when a called custom function is missing', () => {
    const result = compile(`map { s: slugify("x") }`, {
      functions: [slugify],
    });
    expect(() => createMapping(result.compiled!)).toThrow(
      /registered function 'slugify'/,
    );
  });

  test('uncalled registered functions are not required at runtime', () => {
    const result = compile(`map { a: 1 }`, { functions: [slugify] });
    expect(() => createMapping(result.compiled!)).not.toThrow();
  });
});
