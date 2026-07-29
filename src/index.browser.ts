// Bun's bundler drops a module's contents when it consists ONLY of
// re-export statements with no local import/usage of its own (reproduced
// with a minimal repro; not yet fixed upstream as of Bun 1.3.14) — so each
// re-exported module below is also imported directly, forcing Bun to treat
// it as a real dependency instead of silently emitting an empty stub.
import * as _compiler from './compiler/index';
import * as _formatter from './formatter/index';
import * as _parser from './parser/index';
import * as _runtime from './runtime/index';
export const _forceBundlerInclude = [_parser, _compiler, _runtime, _formatter];

export * from './core/index';
export {
  parse,
  tokenize,
  type Token,
  type TokenType,
  type TokenizeOptions,
} from './parser/index';
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
export { format, type FormatResult } from './formatter/index';
