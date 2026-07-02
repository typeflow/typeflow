import { describe, expect, test } from "bun:test";
import { compile } from "@thomasfarineau/typeflow-compiler";
import { format } from "../src/index.ts";

function fmt(source: string): string {
  const result = format(source);
  expect(result.ok).toBe(true);
  return result.formatted;
}

describe("formatter", () => {
  test("canonicalizes messy spacing", () => {
    const out = fmt(`input u:{x:number,name:string}\nmap{a:u.x??0,b:upper( u.name ),c:{x:1,y:2}}`);
    expect(out).toBe(
      `input u: { x: number, name: string }\n` +
        `\n` +
        `map {\n` +
        `  a: u.x ?? 0,\n` +
        `  b: upper(u.name),\n` +
        `  c: { x: 1, y: 2 },\n` +
        `}\n`,
    );
  });

  test("is idempotent", () => {
    const src = `input u:{a?:{b?:string},xs:{n:number,on:boolean}[]}\nmap{v:u.a?.b??"d",w:u.xs[on]->{m:n*2},s:u.xs[0]}`;
    const once = fmt(src);
    expect(fmt(once)).toBe(once);
  });

  test("preserves comments and blank lines", () => {
    const out = fmt(
      `# header comment\ninput u: { x: number }\n\nmap {\n  # about a\n  a: u.x,\n\n  // about b\n  b: u.x * 2,\n}`,
    );
    expect(out).toBe(
      `# header comment\n` +
        `input u: { x: number }\n` +
        `\n` +
        `map {\n` +
        `  # about a\n` +
        `  a: u.x,\n` +
        `\n` +
        `  // about b\n` +
        `  b: u.x * 2,\n` +
        `}\n`,
    );
  });

  test("keeps necessary parentheses and drops none that change meaning", () => {
    const out = fmt(`input u: { x: number, a?: number }\nmap { p: (u.x + 1) * 2, q: u.x + 1 * 2, r: (u.a ?? 1) + 2 }`);
    expect(out).toContain(`p: (u.x + 1) * 2`);
    expect(out).toContain(`q: u.x + 1 * 2`);
    expect(out).toContain(`r: (u.a ?? 1) + 2`);
  });

  test("does not change semantics", () => {
    const src = `input u:{first:string,last:string,tags:{name:string,on:boolean}[]}\nmap{full:u.first+" "+u.last,on:u.tags[on].name,v:u.tags->{l:upper(name)}}`;
    const before = compile(src);
    const after = compile(fmt(src));
    expect(after.diagnostics).toEqual([]);
    expect(JSON.stringify(after.outputType)).toBe(JSON.stringify(before.outputType));
  });

  test("splits long inline types across lines", () => {
    const out = fmt(
      `input user: { id: number, firstName: string, lastName: string, role: "admin" | "member" | "guest", labels: { name: string, active: boolean }[] }\nmap { id: user.id }`,
    );
    expect(out).toContain(`input user: {\n  id: number,\n`);
    expect(out).toContain(`  role: "admin" | "member" | "guest",\n`);
  });

  test("returns unparseable input unchanged", () => {
    const src = `map { broken: `;
    const result = format(src);
    expect(result.ok).toBe(false);
    expect(result.formatted).toBe(src);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
