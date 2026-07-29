import { compile, type CompileResult, type TypeflowFunction } from '#compiler';
import { createMapping, type MappingFn } from './runtime/index';
import { relative, resolve } from 'node:path';
import { createTypeScriptResolver } from '#adapter';
import { formatDiagnostic } from '#core';
import { loadExternalFunctions } from './runtime/external';
import { readFile } from 'node:fs/promises';

export * from './core/index';
export { parse } from './parser/index';
export {
  compile,
  defineFunction,
  emitDts,
  BUILTINS,
  BUILTIN_GROUPS,
} from './compiler/index';
export type {
  Builtin,
  BuiltinGroup,
  BuiltinParam,
  CompileOptions,
  CompileResult,
  DefineFunctionOptions,
  ResolveTypeRequest,
  TypeflowFunction,
  TypeResolver,
} from './compiler/index';
export {
  createMapping,
  runMapping,
  TypeflowRuntimeError,
  type CreateMappingOptions,
  type ExternalFn,
  type MappingFn,
  type NamedFunction,
} from './runtime/index';
export { loadExternalFunctions } from './runtime/external';
export {
  createTypeScriptResolver,
  resolveTypeScriptType,
} from './adapter/index';
export { format, type FormatResult } from './formatter/index';

/** Compile a `.typeflow` file from disk with the TypeScript schema adapter wired in. */
export async function compileTypeflowFile(
  filePath: string,
): Promise<CompileResult> {
  const abs = resolve(filePath);
  const source = await readFile(abs, 'utf8');
  return compile(source, {
    fileName: relative(process.cwd(), abs).replace(/\\/g, '/'),
    filePath: abs,
    resolveType: createTypeScriptResolver(),
  });
}

export interface LoadTypeflowMappingOptions {
  /** Custom functions (from `defineFunction`) available to the mapping. */
  functions?: TypeflowFunction[];
}

/**
 * Compile and instantiate a mapping in one call. Modules referenced by `use`
 * declarations are imported automatically, relative to the mapping file;
 * custom functions from `defineFunction` can be passed via `options.functions`.
 * Throws with tsc-style formatted diagnostics if the file has errors.
 */
export async function loadTypeflowMapping(
  filePath: string,
  options: LoadTypeflowMappingOptions = {},
): Promise<MappingFn> {
  const abs = resolve(filePath);
  const source = await readFile(abs, 'utf8');
  const fileName = relative(process.cwd(), abs).replace(/\\/g, '/');
  const result = compile(source, {
    fileName,
    filePath: abs,
    resolveType: createTypeScriptResolver(),
    functions: options.functions,
  });
  if (!result.ok || !result.compiled) {
    const rendered = result.diagnostics
      .map((d) => formatDiagnostic(d, source, fileName))
      .join('\n');
    throw new Error(`Typeflow compilation failed:\n${rendered}`);
  }
  const imported = await loadExternalFunctions(result.compiled, abs);
  const registered = Object.fromEntries(
    (options.functions ?? []).map((f) => [f.name, f.impl]),
  );
  return createMapping(result.compiled, {
    functions: { ...registered, ...imported },
  });
}
