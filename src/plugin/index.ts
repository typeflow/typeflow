import { type BunPlugin } from 'bun';
import { compile } from '../compiler/index';
import { createTypeScriptResolver } from '../adapter/index';
import { formatDiagnostic } from '../core/index';

/**
 * Bun bundler/runtime plugin: `import mapUser from "./user.typeflow"` resolves to a
 * precompiled mapping function. Compilation errors fail the build with tsc-style output.
 *
 * Usage (bundler): plugins: [typeflowPlugin()]
 * Usage (runtime): Bun.plugin(typeflowPlugin()) in a preload script.
 */
export function typeflowPlugin(): BunPlugin {
  return {
    name: 'typeflow',
    setup(build) {
      const resolver = createTypeScriptResolver();
      build.onLoad({ filter: /\.typeflow$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const result = compile(source, {
          fileName: args.path,
          filePath: args.path,
          resolveType: resolver,
        });
        if (!result.ok || !result.compiled) {
          const rendered = result.diagnostics
            .map((d) => formatDiagnostic(d, source, args.path))
            .join('\n');
          throw new Error(`Typeflow compilation failed:\n${rendered}`);
        }
        const contents =
          `import { createMapping } from "@thomasfarineau/typeflow/runtime";\n` +
          `export default createMapping(${JSON.stringify(result.compiled)});\n`;
        return { contents, loader: 'js' };
      });
    },
  };
}

export default typeflowPlugin;
