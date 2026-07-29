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

// Node only exposes glibc version info on glibc systems; its absence on
// Linux means musl (e.g. Alpine) — the standard napi-rs detection approach.
function isMusl(): boolean {
  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return !report?.header?.glibcVersionRuntime;
}

// Matches the ABI suffix `napi build --platform` bakes into generated .node
// filenames (e.g. `typeflow-converters.win32-x64-msvc.node`).
function abiSuffix(): string {
  if (process.platform === 'win32') return '-msvc';
  if (process.platform === 'linux') return isMusl() ? '-musl' : '-gnu';
  return '';
}

// The npm package a real install's `optionalDependencies` resolution would
// have placed on disk for this platform (see apps/converters/package.json).
function platformPackageName(): string | undefined {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64')
    return '@typeflowjs/converters-win32-x64-msvc';
  if (platform === 'darwin' && arch === 'x64')
    return '@typeflowjs/converters-darwin-x64';
  if (platform === 'darwin' && arch === 'arm64')
    return '@typeflowjs/converters-darwin-arm64';
  if (platform === 'linux' && arch === 'x64' && !isMusl())
    return '@typeflowjs/converters-linux-x64-gnu';
  return undefined;
}

function loadNative(): NativeModule {
  const requireNative = createRequire(import.meta.url);

  // Real npm install path: the matching platform package was pulled in via
  // optionalDependencies.
  const packageName = platformPackageName();
  if (packageName) {
    try {
      return requireNative(packageName) as NativeModule;
    } catch {
      // Not installed — fall through to the local dev build below.
    }
  }

  // Local dev path: `bun run build` compiled a single-platform addon
  // straight into the package root (or dist/, once bundled).
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [here, join(here, '..')];
  const names = [
    `typeflow-converters.${process.platform}-${process.arch}${abiSuffix()}.node`,
    'converter.node',
  ];
  for (const root of roots) {
    for (const name of names) {
      const file = join(root, name);
      if (existsSync(file)) return requireNative(file) as NativeModule;
    }
  }
  throw new Error(
    `@typeflowjs/converters: no prebuilt addon for ${process.platform}-${process.arch}. ` +
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
