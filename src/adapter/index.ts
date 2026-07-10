import { dirname, resolve } from 'node:path';
import { makeUnion, T, type Type } from '#core';
import { type ResolveTypeRequest, type TypeResolver } from '#compiler';
import { existsSync } from 'node:fs';
import ts from 'typescript';

const MAX_DEPTH = 16;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
};

function resolveModuleFile(from: string, baseDir: string): string | undefined {
  const base = resolve(baseDir, from);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    resolve(base, 'index.ts'),
  ];
  return candidates.find((c) => existsSync(c) && !c.endsWith('.d.ts'));
}

/**
 * Create a resolver for `input x: TypeName from "./module"` declarations.
 * Programs are cached per module file, so checking many mappings that share
 * a types module only pays the TS program cost once.
 */
export function createTypeScriptResolver(): TypeResolver {
  const cache = new Map<
    string,
    { program: ts.Program; checker: ts.TypeChecker }
  >();

  return (req: ResolveTypeRequest) => {
    const baseDir = req.filePath ? dirname(req.filePath) : process.cwd();
    const moduleFile = resolveModuleFile(req.from, baseDir);
    if (!moduleFile) {
      return {
        error: `module '${req.from}' was not found (resolved from '${baseDir}').`,
      };
    }

    let entry = cache.get(moduleFile);
    if (!entry) {
      const program = ts.createProgram([moduleFile], COMPILER_OPTIONS);
      entry = { program, checker: program.getTypeChecker() };
      cache.set(moduleFile, entry);
    }
    const { program, checker } = entry;

    const sourceFile = program.getSourceFile(moduleFile);
    if (!sourceFile) return { error: `could not load '${moduleFile}'.` };

    const decl = findTypeDeclaration(sourceFile, req.typeName);
    if (!decl) {
      const available = listTypeNames(sourceFile);
      const hint = available.length
        ? ` Available types: ${available.join(', ')}.`
        : '';
      return {
        error: `type '${req.typeName}' is not declared in '${req.from}'.${hint}`,
      };
    }

    const tsType = checker.getTypeAtLocation(decl.name ?? decl);
    const type = convertType(tsType, checker, decl, new Set(), 0);
    return { type };
  };
}

/** One-shot convenience wrapper around `createTypeScriptResolver`. */
export function resolveTypeScriptType(
  req: ResolveTypeRequest,
): { type: Type } | { error: string } {
  return createTypeScriptResolver()(req);
}

type NamedTypeDecl = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

function findTypeDeclaration(
  sourceFile: ts.SourceFile,
  name: string,
): NamedTypeDecl | undefined {
  for (const stmt of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name.text === name
    ) {
      return stmt;
    }
  }
  return undefined;
}

function listTypeNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      names.push(stmt.name.text);
  }
  return names;
}

function convertType(
  tsType: ts.Type,
  checker: ts.TypeChecker,
  location: ts.Node,
  visiting: Set<ts.Type>,
  depth: number,
): Type {
  if (depth > MAX_DEPTH || visiting.has(tsType)) return T.unknown;

  const flags = tsType.flags;

  if (flags & ts.TypeFlags.StringLiteral)
    return T.literal((tsType as ts.StringLiteralType).value);
  if (flags & ts.TypeFlags.NumberLiteral)
    return T.literal((tsType as ts.NumberLiteralType).value);
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return T.literal(
      (tsType as unknown as { intrinsicName: string }).intrinsicName === 'true',
    );
  }
  if (flags & ts.TypeFlags.String) return T.string;
  if (flags & ts.TypeFlags.Number) return T.number;
  if (flags & ts.TypeFlags.Boolean) return T.boolean;
  if (flags & ts.TypeFlags.Null) return T.null;
  if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return T.undefined;
  if (flags & ts.TypeFlags.Any) return T.any;
  if (flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return T.unknown;

  if (tsType.isUnion()) {
    return makeUnion(
      tsType.types.map((t) =>
        convertType(t, checker, location, visiting, depth + 1),
      ),
    );
  }

  if (checker.isArrayType(tsType)) {
    const args = checker.getTypeArguments(tsType as ts.TypeReference);
    const element = args[0]
      ? convertType(args[0], checker, location, visiting, depth + 1)
      : T.unknown;
    return T.array(element);
  }

  if (checker.isTupleType(tsType)) {
    const args = checker.getTypeArguments(tsType as ts.TypeReference);
    const element = makeUnion(
      args.map((t) => convertType(t, checker, location, visiting, depth + 1)),
    );
    return T.array(args.length ? element : T.unknown);
  }

  if (flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
    const props = tsType.getProperties();
    visiting.add(tsType);
    try {
      const fields = props.map((prop) => {
        const propNode =
          prop.valueDeclaration ?? prop.declarations?.[0] ?? location;
        const propType = checker.getTypeOfSymbolAtLocation(prop, propNode);
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
        let converted = convertType(
          propType,
          checker,
          location,
          visiting,
          depth + 1,
        );
        if (optional) converted = stripUndefinedMember(converted);
        return { name: prop.name, type: converted, optional };
      });
      return T.object(fields);
    } finally {
      visiting.delete(tsType);
    }
  }

  // Enums, generics, template literals, ... degrade to `unknown` rather than lying.
  return T.unknown;
}

function stripUndefinedMember(t: Type): Type {
  if (t.kind === 'undefined') return T.unknown;
  if (t.kind === 'union')
    return makeUnion(t.types.filter((x) => x.kind !== 'undefined'));
  return t;
}
