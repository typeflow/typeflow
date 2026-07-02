import { describe, expect, test } from "bun:test";
import { compile } from "@thomasfarineau/typeflow-compiler";
import { createMapping } from "../src/index.ts";

function run(source: string, input: unknown): unknown {
  const result = compile(source);
  const errs = result.diagnostics.filter((d) => d.severity === "error");
  expect(errs).toEqual([]);
  return createMapping(result.compiled!)(input);
}

describe("runtime", () => {
  test("executes a full mapping", () => {
    const out = run(
      `input u: { first: string, last: string, tags: { name: string, on: boolean }[], scores: number[], c?: { e?: string } }
       map {
         full: u.first + " " + u.last,
         email: u.c?.e ?? "unknown",
         onTags: u.tags[on].name,
         firstTag: u.tags[0],
         views: u.tags -> { label: upper(name) },
         n: count(u.tags),
         total: sum(u.scores),
         joined: join(u.tags.name, ", "),
       }`,
      {
        first: "Ada",
        last: "Lovelace",
        tags: [
          { name: "a", on: true },
          { name: "b", on: false },
          { name: "c", on: true },
        ],
        scores: [1, 2, 3],
      },
    );
    expect(out).toEqual({
      full: "Ada Lovelace",
      email: "unknown",
      onTags: ["a", "c"],
      firstTag: { name: "a", on: true },
      views: [{ label: "A" }, { label: "B" }, { label: "C" }],
      n: 3,
      total: 6,
      joined: "a, b, c",
    });
  });

  test("conditionals and comparisons", () => {
    const out = run(
      `input u: { n: number }\nmap { size: u.n > 10 ? "big" : "small", eq: u.n == 5 }`,
      { n: 5 },
    );
    expect(out).toEqual({ size: "small", eq: true });
  });

  test("missing optional paths yield undefined, defaults apply", () => {
    const out = run(
      `input u: { c?: { e?: string } }\nmap { raw: u.c?.e, safe: u.c?.e ?? "d" }`,
      {},
    ) as Record<string, unknown>;
    expect(out.raw).toBeUndefined();
    expect(out.safe).toBe("d");
  });

  test("does not read inherited properties", () => {
    const out = run(`input u: { toString?: string }\nmap { v: u.toString ?? "clean" }`, {}) as Record<string, unknown>;
    expect(out.v).toBe("clean");
  });

  test("is deterministic across calls", () => {
    const result = compile(`input u: { xs: number[] }\nmap { total: sum(u.xs), n: count(u.xs) }`);
    const fn = createMapping(result.compiled!);
    const input = { xs: [3, 1, 2] };
    expect(JSON.stringify(fn(input))).toBe(JSON.stringify(fn(input)));
  });

  test("compiled mappings survive JSON round-trips", () => {
    const result = compile(`input u: { name: string }\nmap { n: upper(u.name) }`);
    const revived = JSON.parse(JSON.stringify(result.compiled));
    expect(createMapping(revived)({ name: "ada" })).toEqual({ n: "ADA" });
  });
});
