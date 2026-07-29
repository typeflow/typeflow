/**
 * Vite (and plain Rollup) plugin — same shape works for both. In
 * vite.config.ts:
 *
 *   import typeflow from '@typeflowjs/plugin/vite';
 *   export default defineConfig({ plugins: [typeflow()] });
 *
 * Compilation happens here at build/dev time (Node side); the emitted module
 * only imports `typeflowjs/runtime`, which is browser-safe — so `.typeflow`
 * imports work in browser apps, SSR, and library builds alike. `use` module
 * imports are emitted as extension-explicit relative paths, which Vite
 * resolves (and transforms, e.g. for .ts helpers) like any other source file.
 *
 * Deliberately dependency-free: the object below matches the Vite/Rollup
 * plugin interface structurally, without importing either package.
 */
import { esmModuleSource } from './compile';

export default function typeflow(): {
  name: string;
  load(id: string): string | null;
} {
  return {
    name: 'typeflow',
    load(id: string) {
      // Vite may append queries (?t=... on HMR, ?import): strip before matching.
      const file = id.split('?')[0]!;
      if (!file.endsWith('.typeflow')) return null;
      return esmModuleSource(file);
    },
  };
}
