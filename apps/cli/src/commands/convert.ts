/** `convert` — translate jq/JSONata files into Typeflow mappings. */
import { readFile, writeFile } from 'node:fs/promises';
import { expandFilesByExtension } from '#glob';
import { relative } from 'node:path';

export type ConvertType = 'jq' | 'jsonata';

export const CONVERT_TYPES: ConvertType[] = ['jq', 'jsonata'];

const EXTENSION: Record<ConvertType, string> = {
  jq: '.jq',
  jsonata: '.jsonata',
};

export async function cmdConvert(
  patterns: string[],
  type: ConvertType,
): Promise<void> {
  const extension = EXTENSION[type];
  const files = await expandFilesByExtension(patterns, extension);
  if (files.length === 0) {
    console.error(`No ${extension} files found.`);
    process.exit(1);
  }

  // Imported lazily: @typeflowjs/converters loads a native Rust addon at import
  // time and throws when no prebuilt .node exists for the platform — that
  // must only gate `convert`, not every other CLI command.
  let converters: typeof import('@typeflowjs/converters');
  try {
    converters = await import('@typeflowjs/converters');
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // One native call converts the whole batch in parallel across CPU cores
  // (Rust/rayon) — looping and calling the single-file converter per file
  // would pay an FFI round-trip per file and run single-threaded, defeating
  // the point of doing this work in Rust.
  const sources = await Promise.all(
    files.map((file) => readFile(file, 'utf8')),
  );
  const results =
    type === 'jq'
      ? converters.convertJqBatch(sources)
      : converters.convertJsonataBatch(sources);

  let converted = 0;
  let failed = 0;
  const writes: Promise<void>[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const result = results[i]!;
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    if (!result.ok) {
      failed++;
      console.error(`✖ ${rel}: ${result.errors.join('; ')}`);
      continue;
    }
    const outPath = `${file.slice(0, -extension.length)}.typeflow`;
    writes.push(writeFile(outPath, result.typeflow, 'utf8'));
    converted++;
    console.log(
      `converted ${rel} -> ${relative(process.cwd(), outPath).replace(/\\/g, '/')}`,
    );
    for (const note of result.notes) console.log(`  note: ${note}`);
  }
  await Promise.all(writes);

  if (failed > 0) {
    console.error(`✖ ${converted} converted, ${failed} failed.`);
    process.exit(1);
  }
  console.log(`✔ ${converted} file(s) converted.`);
}
