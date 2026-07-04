/**
 * Generates, for each locale (en → docs/, fr → docs/fr/):
 *  - operators/*.md — one page per DocPage declared in scripts/doc-pages/pages/*
 *  - functions/*.md — one page per builtin group in src/builtins/*, plus
 *    index.md (searchable FnIndex) and custom.md
 *  - reference/diagnostics.md — every TF-code, from scripts/doc-pages/diagnostics.ts
 *  - migration/jsonata.md
 * Nothing under these directories is written by hand (all are gitignored).
 * Run with: bun scripts/generate-docs (wired into docs:gen / docs:dev / docs:build).
 *
 * Everything claimable is verified at generation time: migration examples
 * must convert AND compile, diagnostic examples must emit their code, every
 * TF-code present in src/ must be documented — and every French translation
 * must exist (scripts/doc-pages/i18n/*), or the build fails.
 */
import { DOC_PAGES, type DocExample } from './doc-pages';
import {
  FR_CUSTOM_FUNCTIONS_BODY,
  FR_DIAGNOSTICS_INTRO,
  FR_FUNCTIONS_INDEX_INTRO,
  FR_LABELS,
  frMigrationBody,
} from './doc-pages/i18n/fr-pages';
import {
  FR_FUNCTION_DOCS,
  FR_FUNCTION_GROUPS,
} from './doc-pages/i18n/fr-functions';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { BENCH_SCENARIOS } from './bench/scenarios';
import { type Builtin } from '../src/builtins/types';
import { BUILTIN_GROUPS } from '../src/builtins/index';
import { compile } from '../src/compiler/index';
import { convertJsonata } from '../src/converter';
import { createMapping } from '../src/runtime/index';
import { DIAGNOSTICS } from './doc-pages/diagnostics';
import { fileURLToPath } from 'node:url';
import { format } from '../src/formatter';
import { FR_DIAGNOSTICS } from './doc-pages/i18n/fr-diagnostics';
import { FR_OPERATOR_PAGES } from './doc-pages/i18n/fr-operators';
import { join } from 'node:path';
import jsonata from 'jsonata';
import { MIGRATION_EXAMPLES } from '../src/converter/examples';

type Locale = 'en' | 'fr';
const LOCALES: Locale[] = ['en', 'fr'];

function docsDir(locale: Locale, section: string): string {
  const base = locale === 'fr' ? `../docs/fr/${section}` : `../docs/${section}`;
  return fileURLToPath(new URL(base, import.meta.url));
}
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

/** A missing French key is a build error, not a silent English fallback. */
function missing(what: string): never {
  throw new Error(
    `Missing French translation: ${what} — add it in scripts/doc-pages/i18n/`,
  );
}

const BANNER = `<!-- GENERATED FILE — DO NOT EDIT. -->
<!-- Source: scripts/doc-pages/* and src/builtins/*. Regenerate with: bun scripts/generate-docs -->`;

function playground(example: DocExample): string {
  return `::: playground\n\`\`\`typeflow\n${example.mapping}\n\`\`\`\n\`\`\`json\n${example.input}\n\`\`\`\n:::`;
}

function snippetFence(snippet: string): string {
  return `\`\`\`typeflow\n${snippet}\n\`\`\``;
}

function pageHeader(
  order: number,
  title: string,
  includeToc = true,
  showOutline = true,
): string {
  const toc = includeToc ? '\n\n[[toc]]' : '';
  const outline = showOutline ? '' : '\noutline: false';
  // Generated pages have no repo counterpart: no edit link, no git timestamp.
  return `---\norder: ${order}${outline}\neditLink: false\nlastUpdated: false\n---\n\n${BANNER}\n\n# ${title}${toc}`;
}

// ---- operators pages, declared in scripts/doc-pages/pages/* ----

function renderDocPage(
  page: (typeof DOC_PAGES)[number],
  locale: Locale,
): string {
  const fr =
    locale === 'fr'
      ? (FR_OPERATOR_PAGES[page.id] ?? missing(`operator page '${page.id}'`))
      : undefined;
  const frItem = (id: string) =>
    fr ? (fr.items[id] ?? missing(`operator '${page.id}/${id}'`)) : undefined;

  const parts = [pageHeader(page.order, fr?.title ?? page.title)];
  const intro = fr ? fr.intro : page.intro;
  if (page.intro) parts.push(intro ?? missing(`intro of '${page.id}'`));

  // At-a-glance summary table, linking to each item's section.
  const header = fr
    ? `| ${FR_LABELS.opTable.operator} | ${FR_LABELS.opTable.effect} |`
    : '| Operator | Effect |';
  parts.push(
    [header, '| --- | --- |']
      .concat(
        page.items.map(
          (item) =>
            `| [\`${item.name}\`](#${item.id}) | ${frItem(item.id)?.effect ?? item.effect} |`,
        ),
      )
      .join('\n'),
  );

  for (const item of page.items) {
    const f = frItem(item.id);
    parts.push(
      `### \`${item.name}\` : ${f?.effect ?? item.effect} {#${item.id}}`,
    );
    if (item.doc) {
      parts.push(
        f ? (f.doc ?? missing(`doc of '${page.id}/${item.id}'`)) : item.doc,
      );
    }
    if (item.snippet) parts.push(snippetFence(item.snippet));
  }

  if (page.playground) {
    parts.push(`### ${FR_LABELS.playground}`);
    parts.push(playground(page.playground));
  }
  const outro = fr ? fr.outro : page.outro;
  if (page.outro) parts.push(outro ?? missing(`outro of '${page.id}'`));
  return parts.join('\n\n') + '\n';
}

// ---- functions/*.md — one page per builtin group, plus index.md + custom.md ----

const FUNCTION_GROUP_ORDER: Record<string, number> = {
  strings: 1,
  numbers: 2,
  arrays: 3,
  aggregation: 4,
  booleans: 5,
  datetime: 6,
  objects: 7,
};
const CUSTOM_FUNCTIONS_ORDER = 8;

// Groups functions sharing a `category` into contiguous runs, in source order.
// Functions of the same category must be adjacent in the group's `functions` object.
function categoryRuns(
  entries: [string, Builtin][],
): { category: string; entries: [string, Builtin][] }[] {
  const runs: { category: string; entries: [string, Builtin][] }[] = [];
  for (const entry of entries) {
    const category = entry[1].category ?? '';
    const last = runs.at(-1);
    if (last && last.category === category) last.entries.push(entry);
    else runs.push({ category, entries: [entry] });
  }
  return runs;
}

/** One function: name heading (clean outline + anchor) over a highlighted signature card. */
function fnEntry(
  name: string,
  b: Builtin,
  level: '###' | '####',
  locale: Locale,
): string {
  const doc =
    locale === 'fr'
      ? (FR_FUNCTION_DOCS[name] ?? missing(`function doc '${name}'`))
      : b.doc;
  const parts = [
    `${level} \`${name}\` {#${name}}`,
    `<FnSignature code="${encodeURIComponent(b.signature)}" />`,
  ];
  if (doc) parts.push(doc);
  if (b.example) parts.push(snippetFence(b.example));
  return parts.join('\n\n');
}

function renderFunctionGroupPage(
  group: (typeof BUILTIN_GROUPS)[number],
  locale: Locale,
): string {
  const fr =
    locale === 'fr'
      ? (FR_FUNCTION_GROUPS[group.id] ??
        missing(`function group '${group.id}'`))
      : undefined;
  const entries = Object.entries(group.functions);
  const hasCategories = entries.some(([, b]) => b.category);
  const parts = [
    pageHeader(
      FUNCTION_GROUP_ORDER[group.id] ?? 99,
      fr?.title ?? group.title,
      false,
    ),
  ];

  if (group.doc) {
    parts.push(
      fr ? (fr.doc ?? missing(`doc of group '${group.id}'`)) : group.doc,
    );
  }
  // At-a-glance card grid for the group (client component, same data source).
  parts.push(`<FnIndex group="${group.id}" :search="false" />`);

  if (!hasCategories) {
    for (const [name, b] of entries) {
      parts.push(fnEntry(name, b, '###', locale));
    }
  } else {
    for (const run of categoryRuns(entries)) {
      // Anchors always derive from the ENGLISH category label, so category
      // links stay identical across locales (the sidebar relies on this).
      const categorySlug = run.category
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const label = fr
        ? (fr.categories?.[run.category] ??
          missing(`category '${group.id}/${run.category}'`))
        : run.category;
      parts.push(`### ${label} {#${group.id}-${categorySlug}}`);
      for (const [name, b] of run.entries) {
        parts.push(fnEntry(name, b, '####', locale));
      }
    }
  }

  if (group.example) {
    parts.push(`### ${FR_LABELS.playground}`);
    parts.push(playground(group.example));
  }
  return parts.join('\n\n') + '\n';
}

function renderFunctionsIndexPage(locale: Locale): string {
  const fnCount = BUILTIN_GROUPS.reduce(
    (n, g) => n + Object.keys(g.functions).length,
    0,
  );
  const title =
    locale === 'fr' ? FR_LABELS.functionsIndexTitle : 'All functions';
  const intro =
    locale === 'fr'
      ? FR_FUNCTIONS_INDEX_INTRO.replace('{count}', String(fnCount))
      : `The full standard library — **${fnCount} functions**, every one with a typed
signature the compiler enforces (\`TF2007\` for unknown names, \`TF2008\` for
wrong arguments). This index is generated from the same definitions the
compiler and the runtime use, so it cannot drift. Need more?
[Bring your own functions](/functions/custom).`;
  return `${pageHeader(0, title, false, false)}

${intro}

<FnIndex />
`;
}

function renderCustomFunctionsPage(locale: Locale): string {
  if (locale === 'fr') {
    return `${pageHeader(CUSTOM_FUNCTIONS_ORDER, FR_LABELS.customFunctionsTitle, false)}

${FR_CUSTOM_FUNCTIONS_BODY}
`;
  }
  return `${pageHeader(CUSTOM_FUNCTIONS_ORDER, 'Custom functions', false)}

Typeflow ships a **JSONata-level standard library** with typed signatures (see [Functions](/functions/strings)), plus \`use\` declarations to bring your own TypeScript functions into a mapping. Unknown functions are \`TF2007\`, wrong argument types are \`TF2008\` — both at compile time.

When the standard library isn't enough, define your own functions. All three flavors are **checked at compile time** exactly like builtins — unknown names, wrong arity, and wrong argument types are compile errors.

### In the language: \`fn\`

Define pure functions directly in the mapping — the body is a Typeflow expression over the parameters (the input is not in scope, so functions stay reusable and position-independent). The return type is optional: it is inferred from the body, and checked (\`TF2017\`) when declared. Functions can call builtins and functions declared above them — no forward references, so mappings stay terminating.

Fully serializable: \`fn\` definitions travel inside the compiled artifact, so they work everywhere the runtime does — including right here:

::: playground
\`\`\`typeflow
input user: { first: string, last: string, scores: number[] }

fn fullName(first: string, last: string): string = first + " " + last
fn grade(score: number) = score >= 15 ? "A" : score >= 10 ? "B" : "C"

map {
  name: fullName(user.first, user.last),
  grades: user.scores -> { value: $, grade: grade($) },
}
\`\`\`
\`\`\`json
{ "first": "Ada", "last": "Lovelace", "scores": [16, 9, 12] }
\`\`\`
:::

### From TypeScript: \`use\` {#use}

Declare the typed signature in the \`.typeflow\` file; the implementation is imported from the module when the mapping is loaded:

\`\`\`
use slugify(value: string): string from "./helpers"
\`\`\`

\`\`\`ts
// helpers
export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
\`\`\`

\`loadTypeflowMapping("./user.typeflow")\` and \`typeflow run\` import \`./helpers\` automatically. With the low-level runtime API, pass implementations explicitly — instantiation fails fast if one is missing:

\`\`\`ts
createMapping(compiled, { functions: { slugify } });
\`\`\`

### From your app: \`defineFunction\`

Register functions once, application-side — no \`use\` line needed in the mappings. A definition is declared like a builtin: typed signature, doc, implementation:

\`\`\`ts
import { defineFunction, compile, createMapping } from '@thomasfarineau/typeflow';

const slugify = defineFunction('slugify(value: string): string', {
  doc: 'Lowercase, dash-separated slug.',
  impl: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
});

const result = compile(source, { functions: [slugify] });
const run = createMapping(result.compiled!, { functions: [slugify] });
\`\`\`

Optional parameters work (\`clamp(n: number, max?: number): number\`), the compiled artifact records which registered functions the mapping actually calls, and \`createMapping\` fails fast if one is missing. \`loadTypeflowMapping(path, { functions })\` accepts them too.

### Try it live

The playground can't import files, so it provides two demo implementations: \`slugify\` and \`capitalize\` (note the \`?\` — optional parameters are supported):

::: playground
\`\`\`typeflow
input user: { firstName: string, lastName: string }

use slugify(value: string): string from "./helpers"
use capitalize(value: string): string from "./helpers"

map {
  handle: slugify(user.firstName + " " + user.lastName),
  display: capitalize(user.firstName),
}
\`\`\`
\`\`\`json
{ "firstName": "ada", "lastName": "Lovelace" }
\`\`\`
:::

Signatures are enforced like builtins — try \`slugify(42)\` above (\`TF2008\`), or rename a \`use\` to \`upper\` (\`TF2016\`: conflicts with a builtin).

## This example is intentionally broken

Unknown functions are compile errors, and the diagnostic lists what's available:

::: playground
\`\`\`typeflow
input user: { name: string }

map {
  name: capitalizeWords(user.name),
}
\`\`\`
\`\`\`json
{ "name": "ada lovelace" }
\`\`\`
:::
`;
}

// ---- migration/jsonata.md: every example is converted by the real
// ---- converter at generation time, then compiled — a wrong conversion
// ---- fails the docs build instead of shipping.

/** Converts + compiles every migration example (once), returns the worked example. */
function verifyMigrationExamples(): { jsonata: string; typeflow: string } {
  for (const ex of MIGRATION_EXAMPLES) {
    const converted = convertJsonata(ex.jsonata, { input: 'none' });
    if (!converted.ok) {
      throw new Error(
        `Migration example '${ex.title}' failed to convert: ${converted.errors.join('; ')}`,
      );
    }
    const source = `input data: ${ex.inputType}\n\n${converted.typeflow.trim()}`;
    const errors = compile(source).diagnostics.filter(
      (d) => d.severity === 'error',
    );
    if (errors.length > 0) {
      throw new Error(
        `Migration example '${ex.title}' does not compile: ${errors[0]!.message}`,
      );
    }
  }

  // The "Putting it together" example is converted here (not just validated
  // above) and rendered verbatim on the page, so the worked example is
  // literally what the converter produces.
  const worked = MIGRATION_EXAMPLES.find(
    (e) => e.title === 'Putting it together',
  );
  if (!worked) {
    throw new Error("Missing 'Putting it together' migration example.");
  }
  const workedSource = `input data: ${worked.inputType}\n\n${convertJsonata(
    worked.jsonata,
    { input: 'none' },
  ).typeflow.trim()}`;
  // Format the whole thing so the long inline input type wraps like the rest.
  return {
    jsonata: worked.jsonata,
    typeflow: format(workedSource).formatted.trim(),
  };
}

function renderJsonataMigrationPage(
  locale: Locale,
  worked: { jsonata: string; typeflow: string },
): string {
  const workedBody =
    MIGRATION_EXAMPLES.find((e) => e.title === 'Putting it together')?.body ??
    '';

  // Full-width page (aside off, width caps lifted via the .tf-wide marker —
  // see custom.css): the live converter deserves the whole viewport.
  const head = (title: string) => `---
order: 1
aside: false
outline: false
editLink: false
lastUpdated: false
---

${BANNER}

<div class="tf-wide"></div>

# ${title}`;

  if (locale === 'fr') {
    return `${head(FR_LABELS.migrationTitle)}

${frMigrationBody(worked)}
`;
  }

  return `${head('From JSONata')}

Paste a JSONata mapping into the [playground](#playground) and get equivalent, typed Typeflow back. The converter translates the declarative subset faithfully and **reports anything it can't** rather than guessing — so a conversion is either correct or a clear error, never a silent surprise.

## What converts

| JSONata | Typeflow | Notes |
| --- | --- | --- |
| \`{ "a": x }\`, \`[x, y]\` | \`{ a: x }\`, \`[x, y]\` | object & array constructors |
| \`a.b.c\` | \`a.b.c\` | paths (root-relative names get the input prefix) |
| \`items[price > 10]\` | \`items[price > 10]\` | predicate / filter |
| \`items[0]\` | \`items[0]\` | index |
| \`arr^(>a, b)\` | \`arr ^(>a, b)\` | [order-by](/operators/arrays#sort); \`>\` desc, \`<\`/bare asc |
| \`a & b\` | \`(string(a) + string(b))\` | \`&\` → \`+\`, non-strings wrapped in \`string()\` |
| \`a = b\`, \`a != b\` | \`a == b\`, \`a != b\` | comparisons |
| \`a and b\`, \`a or b\` | \`a && b\`, \`a \\|\\| b\` | boolean logic |
| \`c ? a : b\` | \`c ? a : b\` | ternary |
| \`v in list\` | \`count(list[$ == v]) > 0\` | array membership |
| \`+ - * / %\` | \`+ - * / %\` | arithmetic |
| \`$uppercase(x)\`, \`$sum(x)\` | \`upper(x)\`, \`sum(x)\` | \`$\`-stdlib → same name, no \`$\` |
| \`$filter(a, fn($x){ p })\` | \`a[p]\` | single-param lambda → [predicate](/operators/arrays#filter) |
| \`$map(a, fn($x){ o })\` | \`(a) -> $x { o }\` | single-param lambda → [projection](/operators/projection) |
| \`arr.{ ... }\` | \`(arr) -> { ... }\` | per-element object constructor |
| \`arr.( $v := e; { ... } )\` | \`(arr) -> { let $v = e, ... }\` | per-element **block** → [\`let\`](/operators/bindings) bindings |
| \`( $x := e; { ... } )\` | \`{ let $x = e, ... }\` | variable block returning an object |
| \`( $x := e; scalar )\` | scalar with \`$x\` inlined | variable block returning a scalar |
| \`arr[p]#$i.( ... )\` | \`arr[p] -> _, $i { ... }\` | positional [index binder](/operators/projection#index) |
| \`$$\`, \`%\` | \`$root\`, \`$parent\` | root & parent context |
| \`%.%\`, \`%.%.%\`, … | \`$parent.$parent…\` (or \`$root\`) | multi-level parent: a \`$parent\` chain, collapsed to \`$root\` when it reaches the input |
| \`$notInStdlib(x)\` | \`fn notInStdlib(a0) = a0\` | unknown \`$fn\` → a stub \`fn\` mock + a note |

## What doesn't

The converter refuses these instead of emitting something subtly wrong — each comes back in \`errors\`, so the build fails loudly rather than shipping a bad mapping.

| JSONata | Why | Do this instead |
| --- | --- | --- |
| \`$reduce\`, \`$sift\`, \`$each\`, \`$single\` | fold / iterate — no declarative form | an [\`fn\`](/functions/custom) or [\`use\`](/functions/custom#use) function |
| \`( a; b )\` blocks of bare expressions | sequencing without \`:=\` bindings | restructure as [\`fn\`](/functions/custom) definitions |
| \`@$v\` context binds | no equivalent scope | reshape with \`->\` / \`$parent\` explicitly |
| \`#$i\` outside a projection | index needs a \`->\` to bind onto | move it onto the projection: \`arr#$i.( ... )\` |
| wildcards \`*\` / \`**\` | untyped descent | name the paths explicitly |
| \`$eval\`, \`$formatNumber\` pictures | dynamic / locale-formatting | intentionally out of scope |

## Worked example

${workedBody}

**JSONata**

\`\`\`
${worked.jsonata}
\`\`\`

**Typeflow** (exactly what the converter emits)

\`\`\`typeflow
${worked.typeflow}
\`\`\`

Every row above and this whole example are **converted and type-checked by the real converter when these docs are built** — if a translation were wrong, the build would fail instead of shipping it.

## Playground

<JsonataPlayground />
`;
}

// ---- reference/diagnostics.md: every entry is VERIFIED — its example is
// ---- compiled and must emit its code; and every TF-code that appears in
// ---- src/ must be documented. Drift fails the docs build.

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkTsFiles(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function verifyDiagnosticsRegistry(): void {
  // 1. Every documented example actually emits its code.
  for (const d of DIAGNOSTICS) {
    const emitted = compile(d.example.mapping).diagnostics;
    if (!emitted.some((x) => x.code === d.code)) {
      throw new Error(
        `Diagnostics doc for ${d.code} ('${d.title}') does not reproduce: example emitted [${emitted.map((x) => x.code).join(', ') || 'nothing'}]`,
      );
    }
  }
  // 2. Every code emitted anywhere in src/ is documented.
  const documented = new Set(DIAGNOSTICS.map((d) => d.code));
  const undocumented = new Map<string, string>();
  for (const file of walkTsFiles(srcDir)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/'(TF\d{4})'/g)) {
      if (!documented.has(m[1]!)) undocumented.set(m[1]!, file);
    }
  }
  if (undocumented.size > 0) {
    const list = [...undocumented]
      .map(([code, file]) => `${code} (${file})`)
      .join(', ');
    throw new Error(
      `Diagnostic code(s) emitted in src/ but missing from scripts/doc-pages/diagnostics.ts: ${list}`,
    );
  }
}

function badge(severity: string, locale: Locale): string {
  const text = locale === 'fr' ? FR_LABELS.severity[severity]! : severity;
  return severity === 'error'
    ? `<Badge type="danger" text="${text}" />`
    : `<Badge type="warning" text="${text}" />`;
}

function renderDiagnosticsPage(locale: Locale): string {
  const frDiag = (code: string) =>
    FR_DIAGNOSTICS[code] ?? missing(`diagnostic '${code}'`);

  const tableHeader =
    locale === 'fr'
      ? `| ${FR_LABELS.diagTable.code} | ${FR_LABELS.diagTable.severity} | ${FR_LABELS.diagTable.meaning} |`
      : '| Code | Severity | Meaning |';
  const table = [
    tableHeader,
    '| --- | --- | --- |',
    ...DIAGNOSTICS.map((d) => {
      const title = locale === 'fr' ? frDiag(d.code).title : d.title;
      const severity =
        locale === 'fr' ? FR_LABELS.severity[d.severity]! : d.severity;
      return `| [\`${d.code}\`](#${d.code.toLowerCase()}) | ${severity} | ${title} |`;
    }),
  ].join('\n');

  const sections = DIAGNOSTICS.map((d) => {
    const fr = locale === 'fr' ? frDiag(d.code) : undefined;
    const parts = [
      `## \`${d.code}\` — ${fr?.title ?? d.title} ${badge(d.severity, locale)} {#${d.code.toLowerCase()}}`,
      fr?.doc ?? d.doc,
    ];
    if (d.fix) {
      const fix = fr ? (fr.fix ?? missing(`fix of '${d.code}'`)) : d.fix;
      const label = locale === 'fr' ? FR_LABELS.howToFix : 'How to fix';
      parts.push(`**${label}** — ${fix}`);
    }
    parts.push(playground(d.example));
    return parts.join('\n\n');
  });

  const title = locale === 'fr' ? FR_LABELS.diagnosticsTitle : 'Diagnostics';
  const intro =
    locale === 'fr'
      ? FR_DIAGNOSTICS_INTRO
      : `Every diagnostic the compiler can emit, in one place. Errors block
\`typeflow check\` (non-zero exit); warnings don't, but deserve attention.
Codes are stable — safe to grep for, safe to link to.

Every example below is **live** (edit it!) and **verified at build time**:
the docs build compiles each one and fails if it stops reproducing its code.`;

  return `${pageHeader(1, title, false)}

${intro}

${table}

${sections.join('\n\n')}
`;
}

// ---- benchmark scenarios: the /benchmark page claims "same output, three
// ---- engines" — prove it here, or fail the docs build.

async function verifyBenchScenarios(): Promise<void> {
  for (const s of BENCH_SCENARIOS) {
    for (const n of [3, 25]) {
      const input = s.makeInput(n);
      const res = compile(s.typeflow);
      const errors = res.diagnostics.filter((d) => d.severity === 'error');
      if (errors.length > 0) {
        throw new Error(
          `Benchmark scenario '${s.id}' does not compile: ${errors[0]!.message}`,
        );
      }
      const tf = JSON.stringify(createMapping(res.compiled!)(input));
      const js = JSON.stringify((s.js as (i: unknown) => unknown)(input));
      const jn = JSON.stringify(await jsonata(s.jsonata).evaluate(input));
      if (tf !== js || js !== jn) {
        throw new Error(
          `Benchmark scenario '${s.id}' (n=${n}) is not equivalent across engines:\n  typeflow: ${tf.slice(0, 120)}\n  js:       ${js.slice(0, 120)}\n  jsonata:  ${jn.slice(0, 120)}`,
        );
      }
    }
  }
}

// ---- write everything, once per locale ----

verifyDiagnosticsRegistry();
await verifyBenchScenarios();
const worked = verifyMigrationExamples();

for (const locale of LOCALES) {
  const operatorsDir = docsDir(locale, 'operators');
  const functionsDir = docsDir(locale, 'functions');
  const migrationDir = docsDir(locale, 'migration');
  const referenceDir = docsDir(locale, 'reference');
  for (const dir of [operatorsDir, functionsDir, migrationDir, referenceDir]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }

  for (const page of DOC_PAGES) {
    writeFileSync(
      join(operatorsDir, `${page.id}.md`),
      renderDocPage(page, locale),
      'utf8',
    );
  }
  for (const group of BUILTIN_GROUPS) {
    writeFileSync(
      join(functionsDir, `${group.id}.md`),
      renderFunctionGroupPage(group, locale),
      'utf8',
    );
  }
  writeFileSync(
    join(functionsDir, 'index.md'),
    renderFunctionsIndexPage(locale),
    'utf8',
  );
  writeFileSync(
    join(functionsDir, 'custom.md'),
    renderCustomFunctionsPage(locale),
    'utf8',
  );
  writeFileSync(
    join(migrationDir, 'jsonata.md'),
    renderJsonataMigrationPage(locale, worked),
    'utf8',
  );
  writeFileSync(
    join(referenceDir, 'diagnostics.md'),
    renderDiagnosticsPage(locale),
    'utf8',
  );
}

const fnCount = BUILTIN_GROUPS.reduce(
  (n, g) => n + Object.keys(g.functions).length,
  0,
);
console.log(
  `✔ generated en + fr: ${DOC_PAGES.length} operator pages, ${BUILTIN_GROUPS.length} function groups (${fnCount} functions) + index + custom, migration (${MIGRATION_EXAMPLES.length} verified examples), diagnostics (${DIAGNOSTICS.length} verified codes) — per locale`,
);
