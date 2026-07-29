/**
 * Shared compilation core for all three hooks (Node ESM loader, CJS require
 * hook, Bun plugin): compile a .typeflow file synchronously and either hand
 * back the artifact + its `use` imports (CJS builds the mapping in place) or
 * emit a small ESM module around it.
 *
 * The generated module embeds the COMPILED artifact and only imports
 * `typeflowjs/runtime` (the tiny dependency-free interpreter) plus the
 * mapping's own `use` modules — the compiler and the TypeScript adapter run
 * once here, in the hook, not in the consumer's module graph.
 */
import {
  compile,
  type CompiledMapping,
  createTypeScriptResolver,
  formatDiagnostic,
} from 'typeflowjs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export interface UseModuleImport {
  /**
   * Resolved import specifier: for relative `use` paths, a `./`-prefixed
   * relative path WITH its real extension (posix separators) — portable
   * across Node ESM, CJS require, Bun, and Vite/Rollup, since the generated
   * module always resolves relative to the mapping file itself. Bare package
   * names pass through untouched.
   */
  specifier: string;
  /** Named exports the mapping pulls from that module. */
  names: string[];
}

export interface CompiledFile {
  compiled: CompiledMapping;
  useImports: UseModuleImport[];
}

export function compileTypeflowFileSync(filePath: string): CompiledFile {
  const abs = resolve(filePath);
  const source = readFileSync(abs, 'utf8');
  const fileName = relative(process.cwd(), abs).replace(/\\/g, '/');
  const result = compile(source, {
    fileName,
    filePath: abs,
    resolveType: createTypeScriptResolver(),
  });
  if (!result.ok || !result.compiled) {
    const rendered = result.diagnostics
      .map((d) => formatDiagnostic(d, source, fileName))
      .join('\n');
    throw new Error(`Typeflow compilation failed:\n${rendered}`);
  }

  const byModule = new Map<string, string[]>();
  for (const f of result.compiled.functions ?? []) {
    // Registered custom functions (no `from`) can only be supplied
    // programmatically — createMapping reports them with a clear message.
    if (f.from === undefined) continue;
    byModule.set(f.from, [...(byModule.get(f.from) ?? []), f.name]);
  }
  const baseDir = dirname(abs);
  const useImports = [...byModule].map(([from, names]) => ({
    specifier: resolveUseSpecifier(from, baseDir),
    names,
  }));
  return { compiled: result.compiled, useImports };
}

/**
 * Relative `use` specifiers resolve against the mapping file with the same
 * candidate list as typeflowjs's own loadExternalFunctions — and become
 * extension-explicit relative paths, because the generated import must name
 * a concrete file (Node ESM has no extension guessing) and stay portable
 * (file:// URLs would break Vite/Rollup and browser bundling).
 */
function resolveUseSpecifier(from: string, baseDir: string): string {
  const isRelativeOrAbsolute =
    from.startsWith('./') || from.startsWith('../') || isAbsolute(from);
  if (!isRelativeOrAbsolute) return from;
  const base = resolve(baseDir, from);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.js'),
  ];
  const file = candidates.find((c) => existsSync(c) && !c.endsWith('.d.ts'));
  if (!file) {
    throw new Error(
      `Cannot resolve module '${from}' for 'use' declarations (from '${baseDir}').`,
    );
  }
  const rel = relative(baseDir, file).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** The ESM module a `.typeflow` import evaluates to (default export = the mapping fn). */
export function esmModuleSource(filePath: string): string {
  const { compiled, useImports } = compileTypeflowFileSync(filePath);
  const lines = [`import { createMapping } from 'typeflowjs/runtime';`];
  const functionNames: string[] = [];
  for (const { specifier, names } of useImports) {
    lines.push(
      `import { ${names.join(', ')} } from ${JSON.stringify(specifier)};`,
    );
    functionNames.push(...names);
  }
  lines.push(
    `const mapping = createMapping(JSON.parse(${JSON.stringify(JSON.stringify(compiled))}), { functions: { ${functionNames.join(', ')} } });`,
    `export default mapping;`,
  );
  return lines.join('\n');
}
