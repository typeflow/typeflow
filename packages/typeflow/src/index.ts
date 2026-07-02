import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { formatDiagnostic } from "@thomasfarineau/typeflow-core";
import { compile, type CompileResult } from "@thomasfarineau/typeflow-compiler";
import { createMapping, type MappingFn } from "@thomasfarineau/typeflow-runtime";
import { createTypeScriptResolver } from "@thomasfarineau/typeflow-adapter-typescript";

export * from "@thomasfarineau/typeflow-core";
export { parse } from "@thomasfarineau/typeflow-parser";
export { compile, emitDts, BUILTINS } from "@thomasfarineau/typeflow-compiler";
export type { CompileOptions, CompileResult, TypeResolver, ResolveTypeRequest } from "@thomasfarineau/typeflow-compiler";
export { createMapping, runMapping, TypeflowRuntimeError, type MappingFn } from "@thomasfarineau/typeflow-runtime";
export { createTypeScriptResolver, resolveTypeScriptType } from "@thomasfarineau/typeflow-adapter-typescript";
export { typeflowPlugin } from "@thomasfarineau/typeflow-bun-plugin";

/** Compile a `.typeflow` file from disk with the TypeScript schema adapter wired in. */
export async function compileTypeflowFile(filePath: string): Promise<CompileResult> {
  const abs = resolve(filePath);
  const source = await readFile(abs, "utf8");
  return compile(source, {
    fileName: relative(process.cwd(), abs).replace(/\\/g, "/"),
    filePath: abs,
    resolveType: createTypeScriptResolver(),
  });
}

/**
 * Compile and instantiate a mapping in one call.
 * Throws with tsc-style formatted diagnostics if the file has errors.
 */
export async function loadTypeflowMapping(filePath: string): Promise<MappingFn> {
  const abs = resolve(filePath);
  const source = await readFile(abs, "utf8");
  const fileName = relative(process.cwd(), abs).replace(/\\/g, "/");
  const result = compile(source, { fileName, filePath: abs, resolveType: createTypeScriptResolver() });
  if (!result.ok || !result.compiled) {
    const rendered = result.diagnostics.map((d) => formatDiagnostic(d, source, fileName)).join("\n");
    throw new Error(`Typeflow compilation failed:\n${rendered}`);
  }
  return createMapping(result.compiled);
}
