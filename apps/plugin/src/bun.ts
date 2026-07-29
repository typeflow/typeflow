/**
 * Bun runtime/bundler plugin. Wire it up once in bunfig.toml:
 *
 *   preload = ["@typeflowjs/plugin/bun"]
 *
 * and `.typeflow` imports work under `bun run`, `bun test`, and `bun build`.
 */
import { esmModuleSource } from './compile';
import { plugin } from 'bun';

plugin({
  name: 'typeflow',
  setup(build) {
    build.onLoad({ filter: /\.typeflow$/ }, (args) => ({
      loader: 'js',
      contents: esmModuleSource(args.path),
    }));
  },
});
