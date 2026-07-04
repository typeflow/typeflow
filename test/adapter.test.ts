import { describe, expect, test } from 'bun:test';
import { type Type, typeToString } from '../src/core/index';
import { createTypeScriptResolver } from '../src/adapter/index';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./fake.typeflow', import.meta.url));
const resolver = createTypeScriptResolver();

function resolveOk(typeName: string): Type {
  const result = resolver({
    typeName,
    from: './fixtures/shapes',
    filePath: here,
  });
  if ('error' in result) throw new Error(result.error);
  return result.type;
}

describe('typescript adapter', () => {
  test('extracts an interface with primitives, optionals, unions, and arrays', () => {
    const t = resolveOk('Person');
    expect(t.kind).toBe('object');
    const fields = Object.fromEntries(
      (t as Extract<Type, { kind: 'object' }>).fields.map((f) => [f.name, f]),
    );
    expect(typeToString(fields.id!.type)).toBe('number');
    expect(typeToString(fields.role!.type)).toBe('"admin" | "member"');
    expect(typeToString(fields.active!.type)).toBe('boolean');
    expect(fields.nickname!.optional).toBe(true);
    expect(typeToString(fields.nickname!.type)).toBe('string');
    expect(typeToString(fields.tags!.type)).toBe('string[]');
    expect(typeToString(fields.address!.type)).toContain('city: string');
  });

  test('cuts recursive structures off at unknown instead of looping', () => {
    const t = resolveOk('Person') as Extract<Type, { kind: 'object' }>;
    const friends = t.fields.find((f) => f.name === 'friends')!;
    expect(friends.type.kind).toBe('array');
  });

  test('resolves nullable aliases', () => {
    expect(typeToString(resolveOk('MaybeText'))).toBe('string | null');
  });

  test('reports unknown type names with available alternatives', () => {
    const result = resolver({
      typeName: 'Nope',
      from: './fixtures/shapes',
      filePath: here,
    });
    expect('error' in result && result.error).toContain('Person');
  });

  test('reports unresolvable modules', () => {
    const result = resolver({
      typeName: 'X',
      from: './does-not-exist',
      filePath: here,
    });
    expect('error' in result && result.error).toContain('not found');
  });
});
