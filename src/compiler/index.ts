import { type Builtin, BUILTINS } from '../builtins';
import {
  builtinFrom,
  collectCallNames,
  signatureToBuiltin,
  type TypeflowFunction,
} from './functions';
import {
  type CompiledFn,
  type CompiledMapping,
  type Diagnostic,
  type ExternalFunction,
  makeUnion,
  type MappingFile,
  T,
  type Type,
  typeSatisfies,
  typeToString,
} from '../core';
import { Checker } from './checker';
import { parse } from '../parser';
import { typeFromNode } from './type-nodes';

export {
  BUILTINS,
  BUILTIN_GROUPS,
  type Builtin,
  type BuiltinGroup,
  type BuiltinParam,
} from '../builtins';
export {
  defineFunction,
  type DefineFunctionOptions,
  type TypeflowFunction,
} from './functions';
export { typeFromNode } from './type-nodes';
export { emitDts, type EmitDtsOptions } from './emit';

export interface ResolveTypeRequest {
  typeName: string;
  from: string;
  /** Absolute path of the `.typeflow` file, when known — used to resolve relative module paths. */
  filePath?: string;
}

export type TypeResolver = (
  req: ResolveTypeRequest,
) => { type: Type } | { error: string };

export interface CompileOptions {
  fileName?: string;
  filePath?: string;
  resolveType?: TypeResolver;
  /** Custom functions (from `defineFunction`) available to this mapping, checked like builtins. */
  functions?: TypeflowFunction[];
}

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  ast: MappingFile | null;
  inputName: string | null;
  inputType: Type | null;
  outputType: Type | null;
  /** Serializable runtime artifact; present whenever the file parses. */
  compiled: CompiledMapping | null;
}

export function compile(
  source: string,
  options: CompileOptions = {},
): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const { ast, diagnostics: parseDiagnostics } = parse(source);
  diagnostics.push(...parseDiagnostics);

  if (!ast) {
    return {
      ok: false,
      diagnostics,
      ast: null,
      inputName: null,
      inputType: null,
      outputType: null,
      compiled: null,
    };
  }

  let inputName = 'input';
  let inputType: Type = T.any;

  if (!ast.input) {
    diagnostics.push({
      code: 'TF2015',
      message:
        "No 'input' declaration: the input is typed as 'any' and paths cannot be validated.",
      span: ast.map.span,
      severity: 'warning',
      hint: 'Declare one, e.g.: input user: User from "./types"',
    });
  } else {
    inputName = ast.input.name;
    if (ast.input.inlineType) {
      inputType = typeFromNode(ast.input.inlineType);
    } else if (ast.input.typeRef) {
      const { typeName, from } = ast.input.typeRef;
      if (!options.resolveType) {
        diagnostics.push({
          code: 'TF2010',
          message: `Cannot resolve type '${typeName}' from '${from}': no schema adapter is configured.`,
          span: ast.input.span,
          severity: 'error',
        });
      } else {
        const resolved = options.resolveType({
          typeName,
          from,
          filePath: options.filePath,
        });
        if ('error' in resolved) {
          diagnostics.push({
            code: 'TF2010',
            message: `Cannot resolve type '${typeName}' from '${from}': ${resolved.error}`,
            span: ast.input.span,
            severity: 'error',
          });
        } else {
          inputType = resolved.type;
        }
      }
    }
  }

  // Registered custom functions and `use` declarations become checkable
  // signatures alongside the builtins.
  const functions: Record<string, Builtin> = { ...BUILTINS };
  const customNames = new Set<string>();
  for (const fn of options.functions ?? []) {
    if (functions[fn.name]) {
      const kind = BUILTINS[fn.name]
        ? 'a built-in function'
        : 'another registered function';
      diagnostics.push({
        code: 'TF2016',
        message: `Registered function '${fn.name}' conflicts with ${kind}.`,
        span: ast.map.span,
        severity: 'error',
      });
      continue;
    }
    functions[fn.name] = signatureToBuiltin(fn.name, fn.params, fn.returnType);
    customNames.add(fn.name);
  }
  for (const u of ast.uses ?? []) {
    if (functions[u.name]) {
      const kind = BUILTINS[u.name]
        ? 'a built-in function'
        : customNames.has(u.name)
          ? 'a registered custom function'
          : "another 'use' declaration";
      diagnostics.push({
        code: 'TF2016',
        message: `Function '${u.name}' conflicts with ${kind}.`,
        span: u.nameSpan,
        severity: 'error',
      });
      continue;
    }
    functions[u.name] = signatureToBuiltin(u.name, u.params, u.returnType);
  }

  const checker = new Checker(diagnostics, functions);

  // `fn` declarations, in file order: each body is checked with only its
  // parameters in scope and may call anything declared above it (no forward
  // references, hence no recursion — mappings stay terminating).
  const defs: CompiledFn[] = [];
  for (const f of ast.fns ?? []) {
    if (functions[f.name]) {
      const kind = BUILTINS[f.name]
        ? 'a built-in function'
        : 'another function';
      diagnostics.push({
        code: 'TF2016',
        message: `Function '${f.name}' conflicts with ${kind}.`,
        span: f.nameSpan,
        severity: 'error',
      });
      continue;
    }
    const paramTypes = f.params.map((p) => typeFromNode(p.type));
    const vars = new Map(
      f.params.map((p, i) => [
        p.name,
        p.optional ? makeUnion([paramTypes[i]!, T.undefined]) : paramTypes[i]!,
      ]),
    );
    const bodyType = checker.checkFunctionBody(f.body, vars);
    let result = bodyType;
    if (f.returnType) {
      const declared = typeFromNode(f.returnType);
      if (bodyType.kind !== 'any' && !typeSatisfies(bodyType, declared)) {
        diagnostics.push({
          code: 'TF2017',
          message: `Function '${f.name}' returns '${typeToString(bodyType)}', which is not assignable to the declared type '${typeToString(declared)}'.`,
          span: f.returnType.span,
          severity: 'error',
        });
      }
      result = declared;
    }
    functions[f.name] = builtinFrom(f.name, f.params, result);
    defs.push({
      name: f.name,
      params: f.params.map((p) => p.name),
      body: f.body,
    });
  }

  const outputType = checker.checkMapping(ast.map, inputName, inputType);

  // The compiled artifact records every external function the mapping needs:
  // all `use` declarations, plus the registered custom functions called
  // anywhere (map block or `fn` bodies).
  const called = new Set<string>();
  collectCallNames(ast.map, called);
  for (const d of defs) collectCallNames(d.body, called);
  const external: ExternalFunction[] = [
    ...(ast.uses ?? []).map((u) => ({ name: u.name, from: u.from })),
    ...[...customNames].filter((n) => called.has(n)).map((name) => ({ name })),
  ];

  const compiled: CompiledMapping = {
    version: 1,
    inputName,
    ...(external.length > 0 ? { functions: external } : {}),
    ...(defs.length > 0 ? { defs } : {}),
    ir: ast.map,
  };
  const ok = !diagnostics.some((d) => d.severity === 'error');

  return { ok, diagnostics, ast, inputName, inputType, outputType, compiled };
}
