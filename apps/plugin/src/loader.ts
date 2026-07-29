/**
 * Node ESM customization hooks (node:module `register()`): intercepts
 * `.typeflow` URLs at load time and returns the generated ESM module. No
 * resolve hook needed — the default resolver already maps the relative
 * specifier to a file URL; only the unknown-extension load step is ours.
 *
 * Runs on the loader thread: compilation (incl. the TypeScript adapter)
 * happens here, so the consumer's main-thread module graph only ever sees
 * `typeflowjs/runtime` plus the mapping's own `use` modules.
 */
import { esmModuleSource } from './compile';
import { fileURLToPath } from 'node:url';

interface LoadContext {
  format?: string | null;
  [key: string]: unknown;
}
interface LoadResult {
  format: string;
  shortCircuit?: boolean;
  source?: string;
}
type NextLoad = (url: string, context: LoadContext) => Promise<LoadResult>;

export function load(
  url: string,
  context: LoadContext,
  nextLoad: NextLoad,
): Promise<LoadResult> | LoadResult {
  if (!url.endsWith('.typeflow')) return nextLoad(url, context);
  return {
    format: 'module',
    shortCircuit: true,
    source: esmModuleSource(fileURLToPath(url)),
  };
}
