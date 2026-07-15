/**
 * `require('./mapper.typeflow')` support: a require.extensions hook that
 * compiles the file and exports the mapping function directly (no codegen —
 * this side is fully synchronous). `use` modules are loaded with require();
 * on Node >= 22.12 that includes ESM modules without top-level await.
 *
 * module.exports IS the mapping function, with `.default` set to itself so
 * TS-compiled default imports (`import m from './x.typeflow'` under CJS
 * output with esModuleInterop) land on the same function.
 */
import { compileTypeflowFileSync } from './compile';
import { createMapping } from 'typeflow-js/runtime';
import { createRequire } from 'node:module';

type ExternalFn = (...args: unknown[]) => unknown;

export function installRequireHook(): void {
  const nodeRequire = createRequire(import.meta.url);
  const extensions = nodeRequire.extensions;
  if (extensions['.typeflow']) return;
  extensions['.typeflow'] = (module: NodeJS.Module, filename: string) => {
    const { compiled, useImports } = compileTypeflowFileSync(filename);
    const requireFrom = createRequire(filename);
    const functions: Record<string, ExternalFn> = {};
    for (const { specifier, names } of useImports) {
      let mod: Record<string, unknown>;
      try {
        mod = requireFrom(specifier) as Record<string, unknown>;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Failed to require '${specifier}' for 'use' declarations in '${filename}': ${detail}\n` +
            `(ESM 'use' modules need Node >= 22.12 under require(); TypeScript ones need type stripping — otherwise import the mapping instead of requiring it, or point 'from' at a compiled .js module.)`,
          { cause: e },
        );
      }
      const bag = (
        mod.__esModule && mod.default && typeof mod.default === 'object'
          ? (mod.default as Record<string, unknown>)
          : mod
      ) as Record<string, unknown>;
      for (const name of names) {
        const impl = bag[name] ?? mod[name];
        if (typeof impl !== 'function') {
          throw new Error(
            `Module '${specifier}' does not export a function named '${name}'.`,
          );
        }
        functions[name] = impl as ExternalFn;
      }
    }
    const mapping = createMapping(compiled, { functions }) as ((
      input: unknown,
    ) => unknown) & { default?: unknown };
    mapping.default = mapping;
    module.exports = mapping;
  };
}
