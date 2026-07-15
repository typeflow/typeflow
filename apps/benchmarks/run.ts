/**
 * Benchmark runner: the docs' /benchmark comparison, run locally.
 *
 * Same transformation, four implementations (versions read from the
 * installed packages):
 *   - typeflow — createMapping over the compiled artifact (closure runtime)
 *   - jq       — REAL jq (the C codebase, compiled to WASM by jq-wasm), run
 *                in-process; a spawned jq binary would only measure process
 *                startup.
 *   - jsonata  — the JSONata expression (async evaluate, inherent to its API)
 *   - native   — the hand-written JS function (the ceiling)
 *
 * Before timing anything, the outputs are asserted identical (JSON-stringify
 * equality) for every scenario × size — the /benchmark page's guarantee,
 * enforced here too.
 *
 * Writes results/<YYYY-MM-DD>/: results.json, one SVG chart per scenario,
 * a typeflow-vs-jsonata summary chart, and result.md embedding them.
 *
 * Run with: bun run bench — then bun run bench:publish (manual — no longer
 * wired into docs:build/docs:dev) to publish into docs/.
 */
import {
  BENCH_SCENARIOS,
  type BenchScenario,
} from '../../scripts/bench-scenarios';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '../../src/compiler';
import { createMapping } from '../../src/runtime';
import { join } from 'node:path';
import { json as jqJson } from 'jq-wasm';
import { version as jqWasmVersion } from 'jq-wasm/package.json';
import jsonata from 'jsonata';
import { version as jsonataVersion } from 'jsonata/package.json';
import { version as typeflowVersion } from '../../package.json';

const ENGINES = ['typeflow', 'jq', 'jsonata', 'native'] as const;
type Engine = (typeof ENGINES)[number];

// jq-wasm versions look like "3.0.0-jq-1.8.2" — the suffix is the real jq version.
const jqVersion = /-jq-(.+)$/.exec(jqWasmVersion)?.[1] ?? jqWasmVersion;

const VERSIONS: Record<Engine, string> = {
  typeflow: `v${typeflowVersion}`,
  jq: `v${jqVersion} (WASM)`,
  jsonata: `v${jsonataVersion}`,
  native: 'main',
};

interface Measure {
  scenario: string;
  size: number;
  engine: Engine;
  opsPerSec: number;
  iterations: number;
  activeMs: number;
}

type Runner = (input: unknown) => unknown | Promise<unknown>;

const WARMUP_MS = 250;
const TRIALS = 9;
const TRIAL_ACTIVE_MS = 150;

/**
 * Warm up ~250 ms (JIT/WASM-instantiation settle time), then take `TRIALS`
 * independent ~150 ms samples and report the *median* ops/s.
 *
 * A single continuous sample (the previous approach) is one draw from a
 * noisy distribution — GC pauses, OS scheduling, and background load land
 * unevenly across runs and swing the result run-to-run. Several independent
 * trials, each with their own batch-growth ramp-up, resist that: an outlier
 * trial (one bad GC pause) doesn't dominate the median the way it would an
 * average, and the run-to-run report stabilizes.
 */
async function bench(
  fn: () => unknown | Promise<unknown>,
): Promise<{ opsPerSec: number; iterations: number; activeMs: number }> {
  let sink: unknown;
  const warmEnd = performance.now() + WARMUP_MS;
  while (performance.now() < warmEnd) sink = await fn();

  const trialOpsPerSec: number[] = [];
  let totalIterations = 0;
  let totalActive = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    let iterations = 0;
    let active = 0;
    let batch = 1;
    while (active < TRIAL_ACTIVE_MS) {
      const t0 = performance.now();
      for (let i = 0; i < batch; i++) sink = await fn();
      const dt = performance.now() - t0;
      active += dt;
      iterations += batch;
      // Grow batches until each takes ~15 ms, so timer noise stays small.
      if (dt < 15) batch = Math.min(batch * 2, 1 << 20);
    }
    trialOpsPerSec.push(iterations / (active / 1000));
    totalIterations += iterations;
    totalActive += active;
  }
  void sink;
  trialOpsPerSec.sort((a, b) => a - b);
  const median = trialOpsPerSec[Math.floor(trialOpsPerSec.length / 2)]!;
  return {
    opsPerSec: median,
    iterations: totalIterations,
    activeMs: totalActive,
  };
}

function buildEngines(s: BenchScenario): Record<Engine, Runner> {
  const res = compile(s.typeflow);
  if (!res.ok || !res.compiled) {
    throw new Error(
      `Scenario '${s.id}' does not compile: ${JSON.stringify(res.diagnostics)}`,
    );
  }
  const jn = jsonata(s.jsonata);
  return {
    typeflow: createMapping(res.compiled),
    // jq emits a stream; the scenario filters produce exactly one value.
    jq: (input) =>
      jqJson(input as object, s.jq).then((r) => (r as unknown[])[0]),
    jsonata: (input) => jn.evaluate(input),
    native: s.js as Runner,
  };
}

function fmtOps(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} k`;
  return v.toFixed(0);
}

// ---------------------------------------------------------------------------
// Charts — plain SVG files referenced from result.md (portable: GitHub strips
// inline <svg> in markdown). Transparent background + mid-gray inks so the
// same file reads on light and dark surfaces.
// ---------------------------------------------------------------------------

// Categorical slots 1–4 (validated reference palette, light-mode steps):
// typeflow / jq / jsonata / native, fixed order — color follows the engine.
const SERIES: Record<Engine, string> = {
  typeflow: '#2a78d6',
  jq: '#1baf7a',
  jsonata: '#eda100',
  native: '#008300',
};
const INK = '#898781'; // both-mode-safe muted ink
const GRID = 'rgba(137,135,129,0.35)';
const FONT = `font-family="system-ui,-apple-system,'Segoe UI',sans-serif"`;

const ENGINE_LABEL: Record<Engine, string> = {
  typeflow: `Typeflow ${VERSIONS.typeflow}`,
  jq: `jq ${VERSIONS.jq}`,
  jsonata: `JSONata ${VERSIONS.jsonata}`,
  native: 'Native JS',
};

/**
 * One chart per scenario: a group of 4 horizontal bars per size. Within each
 * size group, bars are scaled to that group's max — sizes differ by orders of
 * magnitude, so a shared linear axis would flatten everything. Every bar
 * carries its ops/s value directly, so nothing is color-alone.
 */
function scenarioChart(
  scenario: string,
  rows: Measure[],
  sizes: number[],
): string {
  const width = 760;
  const barH = 18;
  const barGap = 6;
  const groupPad = 26;
  const left = 118;
  const right = 118;
  const legendH = 34;
  const groupH = ENGINES.length * (barH + barGap) - barGap;
  const height =
    legendH + sizes.map(() => groupH + groupPad).reduce((a, b) => a + b, 0) + 8;
  const plotW = width - left - right;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Throughput by engine, scenario ${scenario}">`,
  );

  // Legend: one row, swatch + label per engine.
  let lx = left;
  for (const engine of ENGINES) {
    parts.push(
      `<rect x="${lx}" y="8" width="10" height="10" rx="2" fill="${SERIES[engine]}"/>`,
    );
    const label = ENGINE_LABEL[engine];
    parts.push(
      `<text x="${lx + 15}" y="17" font-size="12" fill="${INK}" ${FONT}>${label}</text>`,
    );
    lx += 15 + label.length * 6.4 + 22;
  }

  let y = legendH;
  for (const size of sizes) {
    const group = ENGINES.map(
      (e) => rows.find((r) => r.size === size && r.engine === e)!,
    );
    const max = Math.max(...group.map((r) => r.opsPerSec));
    parts.push(
      `<text x="${left - 10}" y="${y + groupH / 2 + 4}" font-size="12" text-anchor="end" fill="${INK}" ${FONT}>n = ${size.toLocaleString('en-US')}</text>`,
    );
    parts.push(
      `<line x1="${left}" y1="${y - 4}" x2="${left}" y2="${y + groupH + 4}" stroke="${GRID}" stroke-width="1"/>`,
    );
    let by = y;
    for (const r of group) {
      const w = Math.max(3, (r.opsPerSec / max) * plotW);
      parts.push(
        `<rect x="${left}" y="${by}" width="${w.toFixed(1)}" height="${barH}" rx="3" fill="${SERIES[r.engine]}"/>`,
      );
      parts.push(
        `<text x="${left + w + 8}" y="${by + barH - 5}" font-size="12" fill="${INK}" ${FONT}>${fmtOps(r.opsPerSec)} ops/s</text>`,
      );
      by += barH + barGap;
    }
    y += groupH + groupPad;
  }
  parts.push('</svg>');
  return parts.join('\n');
}

/** Summary chart: Typeflow vs JSONata ratio, one bar per scenario × size. */
function ratioChart(measures: Measure[]): string {
  const rows: { label: string; gain: number }[] = [];
  for (const s of BENCH_SCENARIOS) {
    for (const size of s.sizes) {
      const at = (e: Engine) =>
        measures.find(
          (m) => m.scenario === s.id && m.size === size && m.engine === e,
        )!;
      rows.push({
        label: `${s.id}, n=${size.toLocaleString('en-US')}`,
        gain: at('typeflow').opsPerSec / at('jsonata').opsPerSec,
      });
    }
  }
  const width = 760;
  const barH = 18;
  const barGap = 10;
  const left = 150;
  const right = 80;
  const top = 12;
  const height = top + rows.length * (barH + barGap) - barGap + 16;
  const plotW = width - left - right;
  const max = Math.max(...rows.map((r) => r.gain), 1);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Typeflow throughput relative to JSONata">`,
  );
  // ×1 reference line (parity with JSONata).
  const x1 = left + (1 / max) * plotW;
  parts.push(
    `<line x1="${x1.toFixed(1)}" y1="${top - 6}" x2="${x1.toFixed(1)}" y2="${height - 10}" stroke="${GRID}" stroke-width="1" stroke-dasharray="3 3"/>`,
  );
  parts.push(
    `<text x="${x1.toFixed(1)}" y="${height - 1}" font-size="10" text-anchor="middle" fill="${INK}" ${FONT}>×1</text>`,
  );
  let y = top;
  for (const r of rows) {
    const w = Math.max(3, (r.gain / max) * plotW);
    parts.push(
      `<text x="${left - 10}" y="${y + barH - 5}" font-size="12" text-anchor="end" fill="${INK}" ${FONT}>${r.label}</text>`,
    );
    parts.push(
      `<rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="3" fill="${SERIES.typeflow}"/>`,
    );
    parts.push(
      `<text x="${left + w + 8}" y="${y + barH - 5}" font-size="12" fill="${INK}" ${FONT}>×${r.gain.toFixed(1)}</text>`,
    );
    y += barH + barGap;
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const date = new Date().toISOString().slice(0, 10);
const outDir = join(import.meta.dir, 'results', date);
mkdirSync(outDir, { recursive: true });

const measures: Measure[] = [];

for (const s of BENCH_SCENARIOS) {
  const engines = buildEngines(s);
  for (const size of s.sizes) {
    const input = s.makeInput(size);
    // Equivalence gate: no number is reported for outputs that differ.
    const expected = JSON.stringify(await engines.native(input));
    for (const engine of ENGINES) {
      const got = JSON.stringify(await engines[engine](input));
      if (got !== expected) {
        throw new Error(`Output mismatch: ${s.id} n=${size} engine=${engine}`);
      }
    }
    for (const engine of ENGINES) {
      const fn = engines[engine];
      const r = await bench(() => fn(input));
      measures.push({ scenario: s.id, size, engine, ...r });
      console.log(
        `${s.id.padEnd(10)} n=${String(size).padEnd(6)} ${engine.padEnd(9)} ${fmtOps(r.opsPerSec)} ops/s`,
      );
    }
  }
}

// --- results.json ---
const meta = {
  date,
  runtime: `Bun ${Bun.version}`,
  platform: `${process.platform} ${process.arch}`,
  versions: VERSIONS,
  scenarios: BENCH_SCENARIOS.map((s) => s.id),
  engines: ENGINES,
};
writeFileSync(
  join(outDir, 'results.json'),
  JSON.stringify({ meta, measures }, null, 2),
);

// --- charts ---
for (const s of BENCH_SCENARIOS) {
  const rows = measures.filter((m) => m.scenario === s.id);
  writeFileSync(
    join(outDir, `${s.id}.svg`),
    scenarioChart(s.id, rows, s.sizes),
  );
}
writeFileSync(join(outDir, 'ratio.svg'), ratioChart(measures));

// --- result.md ---
function table(s: BenchScenario): string {
  const header = `| n | Typeflow | jq | JSONata | Native JS | Typeflow vs JSONata | vs native |\n|---|---|---|---|---|---|---|`;
  const lines = s.sizes.map((size) => {
    const at = (e: Engine) =>
      measures.find(
        (m) => m.scenario === s.id && m.size === size && m.engine === e,
      )!;
    const tf = at('typeflow');
    const jqm = at('jq');
    const jn = at('jsonata');
    const na = at('native');
    return `| ${size.toLocaleString('en-US')} | ${fmtOps(tf.opsPerSec)} ops/s | ${fmtOps(jqm.opsPerSec)} ops/s | ${fmtOps(jn.opsPerSec)} ops/s | ${fmtOps(na.opsPerSec)} ops/s | **×${(tf.opsPerSec / jn.opsPerSec).toFixed(1)}** | ×${(na.opsPerSec / tf.opsPerSec).toFixed(1)} |`;
  });
  return [header, ...lines].join('\n');
}

const ratios = BENCH_SCENARIOS.flatMap((s) =>
  s.sizes.map((size) => {
    const at = (e: Engine) =>
      measures.find(
        (m) => m.scenario === s.id && m.size === size && m.engine === e,
      )!;
    return at('typeflow').opsPerSec / at('jsonata').opsPerSec;
  }),
);
const minRatio = Math.min(...ratios).toFixed(1);
const maxRatio = Math.max(...ratios).toFixed(1);

const md = `---
title: Benchmark — ${date}
---

# Benchmark — ${date}

_Measured on: ${meta.runtime}, ${meta.platform}. Scenarios from \`scripts/bench-scenarios.ts\` — the same ones the docs' [/benchmark page](/benchmark) uses. All four implementations are checked to produce identical output (JSON) before any number is measured. Each engine is compiled/parsed once; the numbers compare per-call execution._

## Implementations compared

| Engine | Version | Detail |
|---|---|---|
| **Typeflow** | ${VERSIONS.typeflow} | \`createMapping\` over the compiled artifact — closure-compiling runtime (\`src/runtime/compile.ts\`), no \`eval\`/\`new Function\` |
| **jq** | ${VERSIONS.jq} | REAL jq (the C codebase, compiled to WebAssembly by \`jq-wasm\`), run in-process — a spawned jq binary would only measure process startup. Includes the JSON round-trip to the WASM module, inherent to this execution mode |
| **JSONata** | ${VERSIONS.jsonata} | \`jsonata(expr).evaluate(input)\` — asynchronous API, the promise overhead is included (inherent to its API) |
| **Native JS** | — | the hand-written function: the ceiling, zero interpretation |

## Typeflow vs JSONata

On this machine, Typeflow runs these scenarios **×${minRatio} to ×${maxRatio}** faster than JSONata.

![Typeflow throughput relative to JSONata, by scenario and size](./ratio.svg)

${BENCH_SCENARIOS.map(
  (s) => `## Scenario \`${s.id}\` — ${s.title.en}

${s.note.en}

${table(s)}

_Bars are normalized per size group (the group's max = full width): sizes differ by orders of magnitude, a shared axis would flatten everything. Exact values are on each bar._

![Throughput by engine, scenario ${s.id}](./${s.id}.svg)`,
).join('\n\n')}

## Reading the numbers

- The Typeflow runtime is **compiled into closures**: the IR is walked once at preparation, not on every call. Identifier reads are **statically resolved** where the checker can prove it's safe: a direct read at a known scope depth instead of a full dynamic walk. Filters are **fused with their consumer**: \`arr[pred] -> {…}\`, \`arr[pred].name\` and \`sum\`/\`count\` over them run as one pass, without the intermediate arrays. The gap remaining vs native is mostly the per-element object allocation of projections.
- Microbenchmark: synthetic data, indicative ratios, not absolute.
- Raw data: [\`results.json\`](./results.json).

## Reproducing

\`\`\`sh
bun run bench          # writes apps/benchmarks/results/<date>/
bun run bench:publish  # publishes the reports into the docs (docs/benchmarks/)
\`\`\`
`;

writeFileSync(join(outDir, 'result.md'), md);
console.log(`\nReport written: ${join(outDir, 'result.md')}`);
