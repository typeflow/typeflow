/** Loading of `use`-declared external TS/JS functions (shared by the runtime and the CLI). */
import { dirname, resolve } from 'node:path';
import { type CompiledMapping } from '#core';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function resolveFunctionModule(
  from: string,
  baseDir: string,
): string | undefined {
  const base = resolve(baseDir, from);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.js'),
  ];
  return candidates.find((c) => existsSync(c) && !c.endsWith('.d.ts'));
}

/**
 * Import the modules referenced by a mapping's `use` declarations and collect the
 * named exports, ready to pass to `createMapping(compiled, { functions })`.
 */
export async function loadExternalFunctions(
  compiled: CompiledMapping,
  mappingPath: string,
): Promise<Record<string, (...args: unknown[]) => unknown>> {
  const out: Record<string, (...args: unknown[]) => unknown> = {};
  const byModule = new Map<string, string[]>();
  for (const f of compiled.functions ?? []) {
    // Registered custom functions (no `from`) are provided programmatically,
    // not imported from a module.
    if (f.from === undefined) continue;
    byModule.set(f.from, [...(byModule.get(f.from) ?? []), f.name]);
  }
  const baseDir = dirname(resolve(mappingPath));
  for (const [from, names] of byModule) {
    const isRelative =
      from.startsWith('./') || from.startsWith('../') || from.startsWith('/');
    let specifier = from;
    if (isRelative) {
      const file = resolveFunctionModule(from, baseDir);
      if (!file) {
        throw new Error(
          `Cannot resolve module '${from}' for 'use' declarations (from '${mappingPath}').`,
        );
      }
      specifier = pathToFileURL(file).href;
    }
    let mod: Record<string, unknown>;
    try {
      mod = (await import(specifier)) as Record<string, unknown>;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Failed to import '${from}' for 'use' declarations: ${detail}\n` +
          `(TypeScript modules require Node >= 22.18 or Bun; otherwise point 'from' at a compiled .js module.)`,
        { cause: e },
      );
    }
    for (const name of names) {
      const impl = mod[name];
      if (typeof impl !== 'function') {
        throw new Error(
          `Module '${from}' does not export a function named '${name}'.`,
        );
      }
      out[name] = impl as (...args: unknown[]) => unknown;
    }
  }
  return out;
}
