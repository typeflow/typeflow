/** Typeflow converters (jq / JSONata → Typeflow) as a native Node.js addon. */

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

/** Convert a jq mapping expression to Typeflow source. */
export function convertJq(
  source: string,
  options?: ConvertOptions,
): ConvertResult;

/** Convert a JSONata mapping expression to Typeflow source. */
export function convertJsonata(
  source: string,
  options?: ConvertOptions,
): ConvertResult;

/**
 * Convert many jq mapping expressions to Typeflow source, processed in
 * parallel across CPU cores in Rust (rayon) — one native call for the whole
 * batch, not one call per source. Use this instead of looping over
 * `convertJq` for multi-file conversions.
 */
export function convertJqBatch(
  sources: string[],
  options?: ConvertOptions,
): ConvertResult[];

/** Convert many JSONata mapping expressions in parallel. See `convertJqBatch`. */
export function convertJsonataBatch(
  sources: string[],
  options?: ConvertOptions,
): ConvertResult[];

export interface FormatTypeflowResult {
  ok: boolean;
  /** Canonical source when `ok`; the input unchanged otherwise. */
  formatted: string;
  /** Parse error message when not `ok`. */
  error?: string;
}

/** Format a `.typeflow` source into its canonical form. */
export function formatTypeflow(source: string): FormatTypeflowResult;

/**
 * Render the inline Typeflow type of a sample JSON value, e.g.
 * `{ id: 1, tags: ["a"] }` → `{ id: number, tags: string[] }`.
 * The value must be JSON-serializable.
 */
export function typeFromSample(value: unknown): string;
