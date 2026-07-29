/**
 * Programmatic entry point. Most consumers never import this — they use the
 * side-effect entries instead:
 *
 *   node --import @typeflowjs/plugin/register app.js   # ESM + require() hooks
 *   preload = ["@typeflowjs/plugin/bun"]               # bunfig.toml
 *   plugins: [typeflow()]                            # vite.config.ts, from ./vite
 */
import { installEsmHook } from './esm';
import { installRequireHook } from './cjs';

export { installRequireHook } from './cjs';
export { installEsmHook } from './esm';

/** Install both hooks: the ESM loader and the CommonJS require hook. */
export function register(): void {
  installEsmHook();
  installRequireHook();
}
