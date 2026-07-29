/**
 * Bun can't resolve `workspace:*` for a package that depends on the true
 * repo root (https://github.com/oven-sh/bun/issues/5176). `typeflowjs`
 * itself is also not a declared bun workspace member (there's nothing to be
 * a member of any more — see below), and doesn't declare itself as a real
 * package.json dependency — that would make `bun install`/`bun add` abort.
 * Instead this script manually links it into node_modules/, the same
 * resolution a real npm install of the published package would produce
 * (used by examples/api-response/demo.ts and scripts/check-examples.ts to
 * exercise the public API the same way an external consumer would). Wired
 * into the root "postinstall" script so it's recreated on every install
 * (works on any machine or CI, not just where it was first run).
 *
 * `@typeflowjs/converters`, `@typeflowjs/cli` and `@typeflowjs/plugin` used
 * to be linked here too, back when they lived in this repo as apps/converters,
 * apps/cli and apps/plugin — they're each their own repo/package now
 * (github.com/typeflow/converters, /cli, /plugin-typescript) with their own
 * release cycle and a real dependency on the published `typeflowjs` instead.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

const links: { scope?: string; name: string; target: string }[] = [
  { name: 'typeflowjs', target: root },
];

for (const { scope, name, target } of links) {
  const scopeDir = scope
    ? join(root, 'node_modules', scope)
    : join(root, 'node_modules');
  const linkPath = join(scopeDir, name);
  const label = scope ? `${scope}/${name}` : name;
  mkdirSync(scopeDir, { recursive: true });
  if (existsSync(linkPath)) {
    if (!lstatSync(linkPath).isSymbolicLink()) {
      console.log(
        `node_modules/${label} already exists and is not a symlink; leaving it alone.`,
      );
      continue;
    }
    // Windows junctions are directory reparse points: rmdir removes the
    // link itself (not its target), unlike rmSync which mishandles them.
    try {
      unlinkSync(linkPath);
    } catch {
      rmdirSync(linkPath);
    }
  }
  symlinkSync(
    target,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  console.log(`✔ linked node_modules/${label} -> ${target}`);
}
