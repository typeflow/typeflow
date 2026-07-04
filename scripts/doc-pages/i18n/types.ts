/**
 * French translation dictionaries for the generated docs. Keys are the
 * stable identifiers of the English source of truth (page ids, item ids,
 * function names, diagnostic codes). The generator REFUSES to emit the
 * French locale if a key is missing — translations can't silently drift.
 *
 * Translation rules (applied throughout):
 *  - inline code, signatures and example snippets stay untouched;
 *  - doc links are prefixed with /fr (e.g. /fr/functions/custom);
 *  - established terms keep their English form when idiomatic in French
 *    dev writing: mapping, playground, builtin → « native », parser, etc.
 */

/** One operator/construct of an operators page. */
export interface FrOperatorItem {
  /** French heading effect label (`\`name\` : effect`). */
  effect: string;
  /** French markdown prose (omit when the EN item has none). */
  doc?: string;
}

export interface FrOperatorPage {
  title: string;
  intro?: string;
  outro?: string;
  /** Keyed by DocItem.id. */
  items: Record<string, FrOperatorItem>;
}

export interface FrFunctionGroup {
  title: string;
  /** French group prose (omit when the EN group has none). */
  doc?: string;
  /** English category label → French label (e.g. "Inspect" → "Inspection"). */
  categories?: Record<string, string>;
}

export interface FrDiagnostic {
  title: string;
  doc: string;
  fix?: string;
}
