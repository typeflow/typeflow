import { describe, expect, test } from 'bun:test';
import { parse } from '../src/index';

describe('parser', () => {
  test('parses a full mapping file', () => {
    const { ast, diagnostics } = parse(`
      # a comment
      input user: { id: number, name: string, tags: { label: string, on: boolean }[] }

      map {
        id: user.id,
        name: upper(user.name),
        onTags: user.tags[on].label,
        first: user.tags[0],
        view: user -> { n: name },
        greeting: "hi " + user.name,
        flag: user.id > 3 ? "big" : "small",
      }
    `);
    expect(diagnostics).toEqual([]);
    expect(ast).not.toBeNull();
    expect(ast!.input!.name).toBe('user');
    expect(ast!.input!.inlineType!.kind).toBe('object');
    expect(ast!.map.props.map((p) => p.name)).toEqual([
      'id',
      'name',
      'onTags',
      'first',
      'view',
      'greeting',
      'flag',
    ]);
  });

  test('parses type references with from', () => {
    const { ast, diagnostics } = parse(
      `input u: User from "./types"\nmap { a: u.x }`,
    );
    expect(diagnostics).toEqual([]);
    expect(ast!.input!.typeRef).toEqual({ typeName: 'User', from: './types' });
  });

  test('parses optional chaining and coalescing', () => {
    const { ast } = parse(
      `input u: { a?: { b?: string } }\nmap { v: u.a?.b ?? "x" }`,
    );
    const v = ast!.map.props[0]!.value;
    expect(v.kind).toBe('binary');
  });

  test('parses a sort operator with directions', () => {
    const { ast, diagnostics } = parse(
      `input u: { xs: { p: number, n: string }[] }\nmap { v: u.xs ^(>p, n) }`,
    );
    expect(diagnostics).toEqual([]);
    const v = ast!.map.props[0]!.value;
    expect(v.kind).toBe('sort');
    if (v.kind === 'sort') {
      expect(v.terms).toHaveLength(2);
      expect(v.terms[0]!.descending).toBe(true);
      expect(v.terms[1]!.descending).toBe(false);
    }
  });

  test('rejects an empty sort', () => {
    const { diagnostics } = parse(
      `input u: { xs: number[] }\nmap { v: u.xs ^() }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test('parses let bindings inside a block', () => {
    const { ast, diagnostics } = parse(
      `input u: { x: number }\nmap { let a = u.x, let b = a + 1, v: b }`,
    );
    expect(diagnostics).toEqual([]);
    expect(ast!.map.lets).toHaveLength(2);
    expect(ast!.map.lets!.map((l) => l.name)).toEqual(['a', 'b']);
    expect(ast!.map.props.map((p) => p.name)).toEqual(['v']);
  });

  test('keeps a property literally named "let"', () => {
    const { ast, diagnostics } = parse(`map { let: 1 }`);
    expect(diagnostics).toEqual([]);
    expect(ast!.map.lets ?? []).toHaveLength(0);
    expect(ast!.map.props[0]!.name).toBe('let');
  });

  test('parses a projection with an element alias and index binder', () => {
    const { ast, diagnostics } = parse(
      `input u: { xs: { n: string }[] }\nmap { v: u.xs -> el, i { n: el.n, pos: i } }`,
    );
    expect(diagnostics).toEqual([]);
    const v = ast!.map.props[0]!.value;
    expect(v.kind).toBe('project');
    if (v.kind === 'project') {
      expect(v.binder).toBe('el');
      expect(v.indexBinder).toBe('i');
    }
  });

  test('reports missing map block', () => {
    const { ast, diagnostics } = parse(`input u: { a: string }`);
    expect(ast).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain('map');
  });

  test('reports unterminated string', () => {
    const { diagnostics } = parse(`map { a: "oops }`);
    expect(diagnostics[0]!.code).toBe('TF1001');
  });

  test('parses use declarations', () => {
    const { ast, diagnostics } = parse(
      `use slugify(value: string): string from "./helpers"
use pick(items: string[], n?: number): string[] from "./helpers"
map { a: slugify("x") }`,
    );
    expect(diagnostics).toEqual([]);
    expect(ast!.uses).toHaveLength(2);
    const [slugify, pick] = ast!.uses!;
    expect(slugify!.name).toBe('slugify');
    expect(slugify!.from).toBe('./helpers');
    expect(slugify!.params).toHaveLength(1);
    expect(slugify!.params[0]!.optional).toBe(false);
    expect(pick!.params[1]!.optional).toBe(true);
    expect(pick!.returnType.kind).toBe('array');
  });

  test('reports use without from', () => {
    const { ast, diagnostics } = parse(`use f(a: number): number
map { a: 1 }`);
    expect(ast).toBeNull();
    expect(diagnostics[0]!.message).toContain('from');
  });
});
