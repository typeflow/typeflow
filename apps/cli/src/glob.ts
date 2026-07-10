/** Minimal dependency-free glob over the working tree (`*`, `?`, `**`). */
import { join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

function globToRegex(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` matches zero or more whole segments; trailing `**` matches the rest.
        if (p[i + 2] === '/') {
          re += '(?:[^/]*/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

async function walkFiles(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

/** Like {@link expandFiles}, but for an arbitrary extension (e.g. `.jsonata`, `.jq`). */
export async function expandFilesByExtension(
  patterns: string[],
  extension: string,
): Promise<string[]> {
  if (patterns.length === 0) patterns = [`**/*${extension}`];
  const files = new Set<string>();
  let candidates: string[] | null = null;
  for (const pattern of patterns) {
    if (existsSync(pattern) && pattern.endsWith(extension)) {
      files.add(resolve(pattern));
      continue;
    }
    if (!candidates) {
      candidates = [];
      await walkFiles(process.cwd(), candidates);
    }
    const regex = globToRegex(pattern);
    for (const f of candidates) {
      if (!f.endsWith(extension)) continue;
      const rel = relative(process.cwd(), f).replace(/\\/g, '/');
      if (regex.test(rel)) files.add(f);
    }
  }
  return [...files].toSorted();
}

export async function expandFiles(patterns: string[]): Promise<string[]> {
  return expandFilesByExtension(patterns, '.typeflow');
}
