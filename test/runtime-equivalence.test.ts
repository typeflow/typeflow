/**
 * Non-regression: the closure-compiling runtime (src/runtime/compile.ts, what
 * createMapping uses) must produce the exact same output as the tree-walking
 * interpreter (src/runtime/interpreter.ts, kept as reference) — on the doc's
 * benchmark scenarios and on targeted scoping cases.
 */
import {
  compile,
  defineFunction,
  type TypeflowFunction,
} from '../src/compiler/index';
import { describe, expect, test } from 'bun:test';
import { type Env, evalExpr } from '../src/runtime/interpreter';
import { BENCH_SCENARIOS } from '../scripts/bench/scenarios';
import { createMapping } from '../src/runtime/index';

function both(
  source: string,
  input: unknown,
  functions: TypeflowFunction[] = [],
): { closures: unknown; interpreter: unknown } {
  const result = compile(source, { functions });
  const errs = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errs).toEqual([]);
  const compiled = result.compiled!;
  const closures = createMapping(compiled, { functions })(input);
  const defs = Object.fromEntries(
    (compiled.defs ?? []).map((d) => [d.name, d]),
  );
  const globalEnv: Env = {
    functions: Object.fromEntries(functions.map((f) => [f.name, f.impl])),
    defs,
    depth: { value: 0 },
  };
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

  test('fusion: filter chains, filter→member, filter→project, sum/count', () => {
    const source = `input o: {
      threshold: number,
      nums: number[],
      products: { name: string, price: number, inStock: boolean, tag?: string }[],
    }
    map {
      chained: o.products[inStock][price >= $root.threshold],
      names: o.products[inStock].name,
      projected: o.products[price >= $root.threshold] -> {
        label: name,
        pos: tag ?? "none",
      },
      bound: o.products[inStock] -> p, i { name: p.name, at: i },
      inStock: count(o.products[inStock]),
      stockValue: sum(o.products[inStock].price),
      bigNums: sum(o.nums[$ >= $root.threshold]),
      emptyCount: count(o.products[price < 0]),
      emptySum: sum(o.products[price < 0].price),
    }`;
    const input = {
      threshold: 50,
      nums: [10, 60, 55, 3],
      products: Array.from({ length: 25 }, (_, i) => ({
        name: `p-${i}`,
        // A runtime string in a number field: sum must skip it in both
        // runtimes (numArr in the builtin, the typeof check in the fused pass).
        price: i === 7 ? ('oops' as never) : (i * 13) % 100,
        inStock: i % 3 !== 0,
        ...(i % 4 === 0 ? { tag: `t${i}` } : {}),
      })),
    };
    const { closures, interpreter } = both(source, input);
    expect(closures).toEqual(interpreter as never);
    // Fused paths on a non-array at runtime: filter yields [], so its
    // consumers see an empty array (and sum/count return 0), never a crash.
    const degenerate = both(source, {
      threshold: 50,
      nums: 'nope',
      products: null,
    });
    expect(degenerate.closures).toEqual(degenerate.interpreter as never);
  });

  test('fusion purity guard: external call order matches the interpreter', () => {
    const calls: string[] = [];
    const record = (tag: string, v: unknown): number => {
      calls.push(`${tag}:${String(v)}`);
      return typeof v === 'number' ? v : 0;
    };
    const probe = defineFunction('probe(v: number): number', {
      impl: (v) => record('p', v),
    });
    const mark = defineFunction('mark(v: number): number', {
      impl: (v) => record('m', v),
    });
    // Externals in BOTH the predicate and the body: fusion is refused, so
    // the closure runtime must keep the interpreter's per-stage call order
    // (every predicate call, then the body calls on survivors).
    const source = `input o: { items: { v: number }[] }
    map { out: o.items[probe(v) >= 2] -> { m: mark(v) } }`;
    const input = { items: [{ v: 1 }, { v: 3 }, { v: 2 }] };

    const result = compile(source, { functions: [probe, mark] });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
    const compiled = result.compiled!;

    calls.length = 0;
    const closures = createMapping(compiled, {
      functions: [probe, mark],
    })(input);
    const closureCalls = [...calls];

    calls.length = 0;
    const interpreter = evalExpr(compiled.ir, {
      bindings: { [compiled.inputName]: input },
      rootInput: input,
      parent: {
        functions: { probe: probe.impl, mark: mark.impl },
        defs: {},
        depth: { value: 0 },
      },
    });
    const interpreterCalls = [...calls];

    expect(closures).toEqual(interpreter as never);
    expect(closureCalls).toEqual(interpreterCalls);
    expect(interpreterCalls).toEqual(['p:1', 'p:3', 'p:2', 'm:3', 'm:2']);
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
