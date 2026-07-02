import { describe, expect, test } from "bun:test";
import { parse } from "../src/index.ts";

describe("parser", () => {
  test("parses a full mapping file", () => {
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
    expect(ast!.input!.name).toBe("user");
    expect(ast!.input!.inlineType!.kind).toBe("object");
    expect(ast!.map.props.map((p) => p.name)).toEqual([
      "id", "name", "onTags", "first", "view", "greeting", "flag",
    ]);
  });

  test("parses type references with from", () => {
    const { ast, diagnostics } = parse(`input u: User from "./types"\nmap { a: u.x }`);
    expect(diagnostics).toEqual([]);
    expect(ast!.input!.typeRef).toEqual({ typeName: "User", from: "./types" });
  });

  test("parses optional chaining and coalescing", () => {
    const { ast } = parse(`input u: { a?: { b?: string } }\nmap { v: u.a?.b ?? "x" }`);
    const v = ast!.map.props[0]!.value;
    expect(v.kind).toBe("binary");
  });

  test("reports missing map block", () => {
    const { ast, diagnostics } = parse(`input u: { a: string }`);
    expect(ast).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("map");
  });

  test("reports unterminated string", () => {
    const { diagnostics } = parse(`map { a: "oops }`);
    expect(diagnostics[0]!.code).toBe("TF1001");
  });
});
