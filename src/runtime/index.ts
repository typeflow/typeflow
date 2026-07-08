import { type CompiledMapping } from '../core';
import { compileMapping } from './compile';
import { TypeflowRuntimeError } from './errors';

export { TypeflowRuntimeError } from './errors';

export type MappingFn = (input: unknown) => unknown;

export type ExternalFn = (...args: unknown[]) => unknown;

/** Structural shape of `defineFunction` results — the runtime only needs name + impl. */
export interface NamedFunction {
  name: string;
  impl: ExternalFn;
}

export interface CreateMappingOptions {
  /**
   * Implementations for the mapping's external functions (`use` declarations
   * and registered custom functions): either `defineFunction` results, or a
   * plain record keyed by function name.
   */
  functions?: Record<string, ExternalFn> | NamedFunction[];
}

/** Build an executable mapping from a compiled artifact. Compile once, execute many. */
export function createMapping(
  compiled: CompiledMapping,
  options: CreateMappingOptions = {},
): MappingFn {
  if (compiled.version !== 1) {
    throw new TypeflowRuntimeError(
      `Unsupported compiled mapping version: ${String(compiled.version)}.`,
    );
  }
  const external: Record<string, ExternalFn> = Array.isArray(options.functions)
    ? Object.fromEntries(options.functions.map((f) => [f.name, f.impl]))
    : { ...options.functions };
  for (const decl of compiled.functions ?? []) {
    if (typeof external[decl.name] !== 'function') {
      throw new TypeflowRuntimeError(
        decl.from === undefined
          ? `Mapping uses registered function '${decl.name}'. ` +
              `Pass its definition via createMapping(compiled, { functions: [${decl.name}] }).`
          : `Mapping requires external function '${decl.name}' (from '${decl.from}'). ` +
              `Pass it via createMapping(compiled, { functions: { ${decl.name} } }).`,
      );
    }
  }
  // The IR is compiled once into closures (see ./compile.ts); the returned
  // function only executes direct calls. Compile once, execute many.
  return compileMapping(compiled, external);
}

export function runMapping(
  compiled: CompiledMapping,
  input: unknown,
  options: CreateMappingOptions = {},
): unknown {
  return createMapping(compiled, options)(input);
}
