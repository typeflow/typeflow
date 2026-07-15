/**
 * ESM hook installation shared by index.ts and register.ts: prefer the
 * synchronous in-thread `module.registerHooks()` (Node >= 22.15 — no loader
 * thread, and `module.register()` is deprecated in its favor on Node 26+),
 * fall back to `module.register()` on older Node.
 */
import * as nodeModule from 'node:module';
import { load } from './loader';

export function installEsmHook(): void {
  const mod = nodeModule as typeof nodeModule & {
    registerHooks?: (hooks: { load: typeof load }) => void;
  };
  if (typeof mod.registerHooks === 'function') {
    mod.registerHooks({ load });
  } else {
    nodeModule.register('./loader.js', import.meta.url);
  }
}
