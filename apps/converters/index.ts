/**
 * Typed loader + API adapter for the native addon. Exposes the same option
 * shape as the TypeScript converters in the main `typeflow` package
 * (`input: 'infer' | 'none' | { sample }`) and adapts it to the native
 * surface (which takes the sample as JSON text).
 */
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ConvertOptions {
  /** Name of the Typeflow input binding used for root-relative paths (default: "data"). */
  inputName?: string;
  /**
   * How to produce the `input` declaration:
   * - `'infer'` (default): infer a structural type from usage;
   * - `'none'`: emit only the `map` block;
   * - a sample JSON value: derive the type from it (most precise).
   */
  input?: 'infer' | 'none' | { sample: unknown };
}

export interface ConvertResult {
  ok: boolean;
  /** Generated Typeflow source (canonically formatted when `ok`). */
  typeflow: string;
  /** Semantic caveats worth reviewing after conversion. */
  notes: string[];
  /** Unsupported constructs; when non-empty, `ok` is false. */
  errors: string[];
}

export interface FormatTypeflowResult {
  ok: boolean;
  /** Canonical source when `ok`; the input unchanged otherwise. */
  formatted: string;
  /** Parse error message when not `ok`. */
  error?: string;
}

interface NativeOptions {
  inputName?: string;
  input?: string;
  inputSampleJson?: string;
}

interface NativeModule {
  convertJq(source: string, options?: NativeOptions): ConvertResult;
  convertJsonata(source: string, options?: NativeOptions): ConvertResult;
  convertJqBatch(sources: string[], options?: NativeOptions): ConvertResult[];
  convertJsonataBatch(
    sources: string[],
    options?: NativeOptions,
  ): ConvertResult[];
  formatTypeflow(source: string): FormatTypeflowResult;
  typeFromSample(sampleJson: string): string;
}

function loadNative(): NativeModule {
  const requireNative = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  // Source layout runs from the package root; the built file lives in dist/.
  const roots = [here, join(here, '..')];
  const names = [
    `typeflow-converters.${process.platform}-${process.arch}.node`,
    'converter.node',
  ];
  for (const root of roots) {
    for (const name of names) {
      const file = join(root, name);
      if (existsSync(file)) return requireNative(file) as NativeModule;
    }
  }
  throw new Error(
    `@typeflow/converters: no prebuilt addon for ${process.platform}-${process.arch}. ` +
      'Run `bun run build` (requires a Rust toolchain).',
  );
}

const native = loadNative();

function nativeOptions(options: ConvertOptions = {}): NativeOptions {
  const out: NativeOptions = {};
  if (options.inputName !== undefined) out.inputName = options.inputName;
  if (typeof options.input === 'string') {
    out.input = options.input;
  } else if (options.input !== undefined) {
    out.inputSampleJson = JSON.stringify(options.input.sample);
  }
  return out;
}

/** Convert a jq mapping expression to Typeflow source. */
export function convertJq(
  source: string,
  options?: ConvertOptions,
): ConvertResult {
  return native.convertJq(source, nativeOptions(options));
}

/** Convert a JSONata mapping expression to Typeflow source. */
export function convertJsonata(
  source: string,
  options?: ConvertOptions,
): ConvertResult {
  return native.convertJsonata(source, nativeOptions(options));
}

/**
 * Convert many jq mapping expressions to Typeflow source, processed in
 * parallel across CPU cores in Rust (rayon) — one native call for the whole
 * batch, not one call per source. Use this instead of looping over
 * `convertJq` for multi-file conversions.
 */
export function convertJqBatch(
  sources: string[],
  options?: ConvertOptions,
): ConvertResult[] {
  return native.convertJqBatch(sources, nativeOptions(options));
}

/** Convert many JSONata mapping expressions in parallel. See `convertJqBatch`. */
export function convertJsonataBatch(
  sources: string[],
  options?: ConvertOptions,
): ConvertResult[] {
  return native.convertJsonataBatch(sources, nativeOptions(options));
}

/** Format a `.typeflow` source into its canonical form. */
export function formatTypeflow(source: string): FormatTypeflowResult {
  return native.formatTypeflow(source);
}

/**
 * Render the inline Typeflow type of a sample JSON value, e.g.
 * `{ id: 1, tags: ["a"] }` → `{ id: number, tags: string[] }`.
 * The value must be JSON-serializable.
 */
export function typeFromSample(value: unknown): string {
  return native.typeFromSample(JSON.stringify(value));
}
