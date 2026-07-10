/**
 * Bun can't resolve `workspace:*` for a package that depends on the true
 * repo root (https://github.com/oven-sh/bun/issues/5176) — reproduced here
 * even for a normal, non-root sibling workspace member once the root itself
 * is one of its transitive deps. So apps/cli (and any future apps/*
 * consumer) is deliberately NOT a declared bun workspace member, and doesn't
 * declare `typeflow-js` / `@typeflow/converters` as real package.json
 * dependencies — both would make `bun install`/`bun add` abort.
 * Instead this script manually links each into node_modules/, the same
 * resolution a real npm install of the published packages would produce.
 * Wired into the root "postinstall" script so it's recreated on every
 * install (works on any machine or CI, not just where it was first run).
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
  { name: 'typeflow-js', target: root },
  {
    scope: '@typeflow',
    name: 'converters',
    target: join(root, 'apps', 'converters'),
  },
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
