import { describe, expect, test } from 'bun:test';
import { compile } from '../src/compiler/index';
import { convertJq } from '../src/converter';
import { createMapping } from '../src/runtime/index';

function convertAndRun(jq: string, inputType: string, input: unknown): unknown {
  const converted = convertJq(jq, { input: 'none' });
  expect(converted.errors).toEqual([]);
  const source = `input data: ${inputType}\n\n${converted.typeflow}`;
  const result = compile(source);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return createMapping(result.compiled!)(input);
}

describe('convertJq', () => {
  test('reshapes objects and paths', () => {
    const out = convertAndRun(
      `{ fullName: (.firstName + " " + .lastName), city: .address.city }`,
      '{ firstName: string, lastName: string, address: { city: string } }',
      { firstName: 'Ada', lastName: 'Lovelace', address: { city: 'London' } },
    );
    expect(out).toEqual({ fullName: 'Ada Lovelace', city: 'London' });
  });

  test('converts array iteration, select, and field extraction through pipes', () => {
    const out = convertAndRun(
      `.products[] | select(.price > 100) | .name`,
      '{ products: { name: string, price: number }[] }',
      {
        products: [
          { name: 'keyboard', price: 120 },
          { name: 'cable', price: 9 },
        ],
      },
    );
    expect(out).toEqual({ value: ['keyboard'] });
  });

  test('converts jq map to Typeflow projection', () => {
    const out = convertAndRun(
      `.items | map({ label: .name, score: .score })`,
      '{ items: { name: string, score: number }[] }',
      { items: [{ name: 'ada', score: 16 }] },
    );
    expect(out).toEqual({ value: [{ label: 'ada', score: 16 }] });
  });

  test('converts filtered array pipeline into object projection', () => {
    const out = convertAndRun(
      `.products[] | select(.price >= 50) | { label: (.name | ascii_upcase), price: .price }`,
      '{ products: { name: string, price: number }[] }',
      {
        products: [
          { name: 'keyboard', price: 120 },
          { name: 'cable', price: 9 },
        ],
      },
    );
    expect(out).toEqual({ value: [{ label: 'KEYBOARD', price: 120 }] });
  });

  test('converts sort_by to Typeflow order-by', () => {
    const out = convertAndRun(
      `.orders | sort_by(.total) | map({ id: .id })`,
      '{ orders: { id: number, total: number }[] }',
      { orders: [{ id: 2, total: 5 }, { id: 1, total: 3 }] },
    );
    expect(out).toEqual({ value: [{ id: 1 }, { id: 2 }] });
  });

  test('converts jq fallback to Typeflow nullish fallback', () => {
    const out = convertAndRun(
      `{ email: (.contact.email // "unknown") }`,
      '{ contact?: { email?: string } }',
      { contact: {} },
    );
    expect(out).toEqual({ email: 'unknown' });
  });

  test('infers an input declaration by default', () => {
    const converted = convertJq(`{ name: .user.name, expensive: .products[] | select(.price > 100) | .name }`);
    expect(converted.ok).toBe(true);
    expect(converted.typeflow).toContain('input data:');
    expect(converted.typeflow).toContain('user: { name: unknown }');
    expect(converted.typeflow).toContain('price: number');
  });

  test('reports unsupported jq functions', () => {
    const converted = convertJq(`walk(.)`);
    expect(converted.ok).toBe(false);
    expect(converted.errors.join(' ')).toContain("Unsupported jq function 'walk'");
  });
});
