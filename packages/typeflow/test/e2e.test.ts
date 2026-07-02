import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { compileTypeflowFile, createMapping, emitDts, loadTypeflowMapping } from "../src/index.ts";

const exampleDir = new URL("../../../examples/api-response/", import.meta.url);
const mappingFile = fileURLToPath(new URL("./user.typeflow", exampleDir));
const sampleFile = fileURLToPath(new URL("./sample.json", exampleDir));

describe("end to end (examples/api-response)", () => {
  test("compiles the example with zero diagnostics", async () => {
    const result = await compileTypeflowFile(mappingFile);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("transforms the sample input into the expected view model", async () => {
    const result = await compileTypeflowFile(mappingFile);
    const sample = JSON.parse(await readFile(sampleFile, "utf8"));
    const output = createMapping(result.compiled!)(sample);
    expect(output).toEqual({
      id: 42,
      fullName: "Ada Lovelace",
      isAdmin: true,
      email: "unknown",
      activeTags: ["founder", "math"],
      tagCount: 3,
      totalScore: 42,
      address: { city: "London", country: "unknown" },
    });
  });

  test("emits declarations with the inferred output type", async () => {
    const result = await compileTypeflowFile(mappingFile);
    const dts = emitDts(result, { sourceFileName: "user.typeflow" });
    expect(dts).toContain("fullName: string");
    expect(dts).toContain("isAdmin: boolean");
    expect(dts).toContain("activeTags: string[]");
    expect(dts).toContain("export default mapping;");
  });

  test("loadTypeflowMapping throws formatted diagnostics on bad files", async () => {
    expect(loadTypeflowMapping(fileURLToPath(new URL("./nope.typeflow", exampleDir)))).rejects.toThrow();
  });
});
