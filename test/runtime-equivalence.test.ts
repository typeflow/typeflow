/**
 * Non-regression: the closure-compiling runtime (src/runtime/compile.ts, what
 * createMapping uses) must produce the exact same output as the tree-walking
 * interpreter (src/runtime/interpreter.ts, kept as reference) — on the doc's
 * benchmark scenarios and on targeted scoping cases.
 */
import { describe, expect, test } from 'bun:test';
import { type Env, evalExpr } from '../src/runtime/interpreter';
import { BENCH_SCENARIOS } from '../scripts/bench/scenarios';
import { compile } from '../src/compiler/index';
import { createMapping } from '../src/runtime/index';

function both(
  source: string,
  input: unknown,
): { closures: unknown; interpreter: unknown } {
  const result = compile(source);
  const errs = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errs).toEqual([]);
  const compiled = result.compiled!;
  const closures = createMapping(compiled)(input);
  const defs = Object.fromEntries(
    (compiled.defs ?? []).map((d) => [d.name, d]),
  );
  const globalEnv: Env = { functions: {}, defs, depth: { value: 0 } };
  const interpreter = evalExpr(compiled.ir, {
    bindings: { [compiled.inputName]: input },
    rootInput: input,
    parent: globalEnv,
  });
  return { closures, interpreter };
}

describe('closure runtime ≡ interpreter', () => {
  for (const s of BENCH_SCENARIOS) {
    for (const size of s.sizes) {
      test(`${s.id}, n=${size}`, () => {
        const { closures, interpreter } = both(s.typeflow, s.makeInput(size));
        expect(closures).toEqual(interpreter as never);
      });
    }
  }

  test('static ident resolution: shadowing, binders, optional fields, index', () => {
    const source = `input o: {
      name: string,
      idx: number,
      items: { name: string, v: number, note?: string, sub: { name: string, w: number }[] }[],
    }
    map {
      let name = o.name,
      let doubled = o.idx * 2,
      byIndex: o.items[doubled],
      picked: o.items -> it, i {
        outer: name,
        own: it.name,
        bare: name,
        pos: i,
        maybe: note ?? "none",
        deep: sub[w >= $root.idx] -> { child: name, up: $parent.name },
      },
    }`;
    const input = {
      name: 'root',
      idx: 1,
      items: [
        {
          name: 'a',
          v: 3,
          sub: [
            { name: 's1', w: 0 },
            { name: 's2', w: 5 },
          ],
        },
        { name: 'b', v: 8, note: 'hey', sub: [] },
      ],
    };
    const { closures, interpreter } = both(source, input);
    expect(closures).toEqual(interpreter as never);
  });

  test('$parent / $root / let / fn / sort', () => {
    const source = `input o: { min: number, groups: { name: string, items: { v: number }[] }[] }
      fn double(x: number): number = x * 2
      map {
        let m = o.min,
        picked: o.groups -> g {
          name: g.name,
          big: g.items[v >= $root.min] -> { v: v, from: $parent.name, d: double(v) },
          sorted: g.items ^(>v),
        },
        m2: double(m),
      }`;
    const input = {
      min: 5,
      groups: [
        { name: 'a', items: [{ v: 3 }, { v: 8 }, { v: 5 }] },
        { name: 'b', items: [{ v: 10 }] },
      ],
    };
    const { closures, interpreter } = both(source, input);
    expect(closures).toEqual(interpreter as never);
  });
});
