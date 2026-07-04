/**
 * Declarative documentation model: every page of the "Operators" section is
 * declared in code (scripts/doc-pages/pages/*) and docs/operators/*.md is
 * generated from it by scripts/generate-docs — nothing is written by hand there.
 *
 * Rendering per page: intro → summary table (one linked row per item) →
 * `### \`name\` : effect` per item (so every element shows up in the
 * "On this page" outline) → a final `### Playground`.
 */

export interface DocExample {
  /** Playground mapping source (.typeflow). */
  mapping: string;
  /** Playground input JSON. */
  input: string;
}

/** One operator / construct: a summary-table row and its own `###` heading. */
export interface DocItem {
  /** Display name, e.g. `+`, `?.`, `->`, `[condition]`. */
  name: string;
  /** Anchor id (stable, url-safe), e.g. `add`, `optional-chain`. */
  id: string;
  /** Short effect label: heading is `\`name\` : effect`. */
  effect: string;
  /** Markdown prose under the heading. */
  doc?: string;
  /** Small static .typeflow snippet illustrating the item. */
  snippet?: string;
}

export interface DocPage {
  /** URL slug: docs/operators/<id>.md */
  id: string;
  title: string;
  /** Sidebar position. */
  order: number;
  /** Markdown prose rendered under the page title. */
  intro?: string;
  items: DocItem[];
  /** The final `### Playground` — one live example exercising the page. */
  playground?: DocExample;
  /** Markdown prose rendered after the playground. */
  outro?: string;
}
