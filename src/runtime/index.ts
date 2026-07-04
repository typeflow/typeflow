import { type Env, evalExpr } from './interpreter';
import { type CompiledMapping } from '../core';
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
  const defs = Object.fromEntries(
    (compiled.defs ?? []).map((d) => [d.name, d]),
  );
  return (input: unknown) => {
    // Globals (external functions + `fn` definitions) live above the input
    // binding, so `fn` bodies see their parameters and globals — nothing else.
    const globalEnv: Env = { functions: external, defs, depth: { value: 0 } };
    const root: Env = {
      bindings: { [compiled.inputName]: input },
      rootInput: input,
      parent: globalEnv,
    };
    return evalExpr(compiled.ir, root);
  };
}

export function runMapping(
  compiled: CompiledMapping,
  input: unknown,
  options: CreateMappingOptions = {},
): unknown {
  return createMapping(compiled, options)(input);
}
