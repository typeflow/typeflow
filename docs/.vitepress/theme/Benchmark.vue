<script setup lang="ts">
import {
  BENCH_SCENARIOS,
  type BenchScenario,
} from '../../../scripts/bench/scenarios';
import { computed, reactive, ref } from 'vue';
import { compile } from '@thomasfarineau/typeflow-compiler';
import { convertJq } from '@thomasfarineau/typeflow-converter';
import { createMapping } from '@thomasfarineau/typeflow-runtime';
import { highlightTypeflow } from './highlight';
import jsonata from 'jsonata';
import { useData } from 'vitepress';

const { lang } = useData();
const isFr = computed(() => lang.value === 'fr');
const ui = computed(() =>
  isFr.value
    ? {
        run: 'Lancer le benchmark',
        running: 'Mesure en cours…',
        size: 'Taille des tableaux',
        opsSec: 'ops/s',
        fastest: 'le plus rapide',
        prepare: 'coût unique (compilation / parse)',
        engines: {
          tf: 'Typeflow',
          jq: 'jq',
          jn: 'JSONata',
          js: 'JS natif',
        },
        mismatch:
          'Les quatre implémentations ne produisent pas la même sortie — benchmark annulé.',
        verified: 'sorties identiques vérifiées avant mesure ✔',
      }
    : {
        run: 'Run benchmark',
        running: 'Measuring…',
        size: 'Array size',
        opsSec: 'ops/s',
        fastest: 'fastest',
        prepare: 'one-time cost (compile / parse)',
        engines: {
          tf: 'Typeflow',
          jq: 'jq',
          jn: 'JSONata',
          js: 'Native JS',
        },
        mismatch:
          'The four implementations disagree on the output — benchmark aborted.',
        verified: 'identical outputs verified before measuring ✔',
      },
);

type EngineId = 'js' | 'tf' | 'jq' | 'jn';
const ENGINE_ORDER: EngineId[] = ['js', 'tf', 'jq', 'jn'];

interface EngineResult {
  engine: EngineId;
  opsSec: number;
  prepareMs: number | null;
}
interface ScenarioState {
  size: number;
  tab: 'tf' | 'jq' | 'jn' | 'js';
  status: 'idle' | 'running' | 'done' | 'error';
  current: EngineId | null;
  results: EngineResult[];
}

const states = reactive<Record<string, ScenarioState>>(
  Object.fromEntries(
    BENCH_SCENARIOS.map((s) => [
      s.id,
      {
        size: s.defaultSize,
        tab: 'tf' as const,
        status: 'idle' as const,
        current: null,
        results: [],
      },
    ]),
  ),
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function codeHtml(
  s: BenchScenario,
  tab: 'tf' | 'jq' | 'jn' | 'js',
): string {
  if (tab === 'tf') return highlightTypeflow(s.typeflow);
  if (tab === 'jq') return escapeHtml(s.jq);
  if (tab === 'jn') return escapeHtml(s.jsonata);
  return escapeHtml(String(s.js));
}

function inputDeclaration(source: string): string {
  const marker = '\n\nmap';
  const end = source.indexOf(marker);
  if (end === -1) throw new Error('Benchmark scenario is missing a map block.');
  return source.slice(0, end).trim();
}

const yieldToUi = () => new Promise((r) => setTimeout(r));

/** Adaptive loop: only ACTIVE time counts (UI yields excluded). */
async function measureSync(fn: () => unknown, targetMs = 250): Promise<number> {
  let sink: unknown;
  for (let i = 0; i < 20; i++) sink = fn();
  let iters = 0;
  let active = 0;
  let batch = 8;
  while (active < targetMs) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) sink = fn();
    active += performance.now() - t0;
    iters += batch;
    batch = Math.min(batch * 2, 8192);
    await yieldToUi();
  }
  void sink;
  return iters / (active / 1000);
}

async function measureAsync(
  fn: () => Promise<unknown>,
  targetMs = 250,
): Promise<number> {
  let sink: unknown;
  for (let i = 0; i < 20; i++) sink = await fn();
  let iters = 0;
  let active = 0;
  let batch = 8;
  while (active < targetMs) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) sink = await fn();
    active += performance.now() - t0;
    iters += batch;
    batch = Math.min(batch * 2, 4096);
    await yieldToUi();
  }
  void sink;
  return iters / (active / 1000);
}

function timePrepare(fn: () => unknown, k = 10): number {
  const t0 = performance.now();
  for (let i = 0; i < k; i++) fn();
  return (performance.now() - t0) / k;
}

async function run(s: BenchScenario): Promise<void> {
  const st = states[s.id]!;
  st.status = 'running';
  st.results = [];
  st.current = null;
  try {
    const input = s.makeInput(st.size);

    // One-time costs, then the prepared artifacts used for the timed runs.
    const prepareTf = timePrepare(() => {
      const r = compile(s.typeflow);
      return createMapping(r.compiled!);
    });
    const prepareJn = timePrepare(() => jsonata(s.jsonata));
    const prepareJq = timePrepare(() => {
      const converted = convertJq(s.jq, {
        input: 'none',
        inputName: s.inputName,
      });
      const source = `${inputDeclaration(s.typeflow)}\n\n${converted.typeflow}`;
      return createMapping(compile(source).compiled!);
    });
    const tfRun = createMapping(compile(s.typeflow).compiled!);
    const jnExpr = jsonata(s.jsonata);
    const jqConverted = convertJq(s.jq, {
      input: 'none',
      inputName: s.inputName,
    });
    const jqRun = createMapping(
      compile(`${inputDeclaration(s.typeflow)}\n\n${jqConverted.typeflow}`)
        .compiled!,
    );
    const jsFn = s.js as (i: unknown) => unknown;

    // The page's whole premise: same output. Re-check on THIS input size.
    const a = JSON.stringify(tfRun(input));
    const b = JSON.stringify(jsFn(input));
    const c = JSON.stringify(await jnExpr.evaluate(input));
    const d = JSON.stringify(jqRun(input));
    if (a !== b || b !== c || b !== d) {
      st.status = 'error';
      return;
    }

    st.current = 'js';
    await yieldToUi();
    const js = await measureSync(() => jsFn(input));
    st.current = 'tf';
    const tf = await measureSync(() => tfRun(input));
    st.current = 'jq';
    const jq = await measureSync(() => jqRun(input));
    st.current = 'jn';
    const jn = await measureAsync(() => jnExpr.evaluate(input));

    st.results = [
      { engine: 'js', opsSec: js, prepareMs: null },
      { engine: 'tf', opsSec: tf, prepareMs: prepareTf },
      { engine: 'jq', opsSec: jq, prepareMs: prepareJq },
      { engine: 'jn', opsSec: jn, prepareMs: prepareJn },
    ];
    st.status = 'done';
  } catch {
    st.status = 'error';
  } finally {
    st.current = null;
  }
}

const fmtInt = computed(
  () =>
    new Intl.NumberFormat(isFr.value ? 'fr-FR' : 'en-US', {
      maximumFractionDigits: 0,
    }),
);
function fmtOps(n: number): string {
  return fmtInt.value.format(Math.round(n));
}
function fmtMs(ms: number): string {
  return ms >= 1 ? `${ms.toFixed(2)} ms` : `${Math.round(ms * 1000)} µs`;
}
function relOf(st: ScenarioState, r: EngineResult): number {
  const max = Math.max(...st.results.map((x) => x.opsSec));
  return r.opsSec / max;
}
</script>

<template>
  <div class="bench">
    <section v-for="s in BENCH_SCENARIOS" :key="s.id" class="bench-card">
      <header class="bench-head">
        <h3 class="bench-title">{{ isFr ? s.title.fr : s.title.en }}</h3>
        <p class="bench-note">{{ isFr ? s.note.fr : s.note.en }}</p>
      </header>

      <div class="bench-tabs" role="tablist">
        <button
          v-for="t in ['tf', 'jq', 'jn', 'js'] as const"
          :key="t"
          class="bench-tab"
          :class="{ active: states[s.id]!.tab === t }"
          role="tab"
          :aria-selected="states[s.id]!.tab === t"
          @click="states[s.id]!.tab = t">
          {{ ui.engines[t] }}
        </button>
      </div>
      <pre
        class="bench-code"
        tabindex="0"><code v-html="codeHtml(s, states[s.id]!.tab)"></code></pre>

      <div class="bench-controls">
        <span class="bench-size-label">{{ ui.size }}</span>
        <div class="bench-sizes">
          <button
            v-for="n in s.sizes"
            :key="n"
            class="bench-chip"
            :class="{ active: states[s.id]!.size === n }"
            :disabled="states[s.id]!.status === 'running'"
            @click="states[s.id]!.size = n">
            {{ fmtInt.format(n) }}
          </button>
        </div>
        <button
          class="bench-run"
          :disabled="states[s.id]!.status === 'running'"
          @click="run(s)">
          {{ states[s.id]!.status === 'running' ? ui.running : ui.run }}
        </button>
      </div>

      <p v-if="states[s.id]!.status === 'error'" class="bench-error">
        {{ ui.mismatch }}
      </p>

      <div v-if="states[s.id]!.status !== 'idle'" class="bench-results">
        <div
          v-for="e in ENGINE_ORDER"
          :key="e"
          class="bench-row"
          :class="{
            measuring:
              states[s.id]!.status === 'running' && states[s.id]!.current === e,
          }">
          <span class="bench-name">
            <span class="bench-swatch" :class="`sw-${e}`" aria-hidden="true" />
            {{ ui.engines[e] }}
          </span>
          <span class="bench-track" aria-hidden="true">
            <span
              v-if="states[s.id]!.results.length"
              class="bench-bar"
              :class="`bar-${e}`"
              :style="{
                width: `${Math.max(1.5, relOf(states[s.id]!, states[s.id]!.results.find((r) => r.engine === e)!) * 100)}%`,
              }" />
          </span>
          <span v-if="states[s.id]!.results.length" class="bench-value">
            <template
              v-for="r in [states[s.id]!.results.find((x) => x.engine === e)!]"
              :key="r.engine">
              <strong>{{ fmtOps(r.opsSec) }}</strong> {{ ui.opsSec }}
              <em v-if="relOf(states[s.id]!, r) === 1" class="bench-fastest">{{
                ui.fastest
              }}</em>
              <em v-else class="bench-rel"
                >×{{ relOf(states[s.id]!, r).toFixed(2) }}</em
              >
            </template>
          </span>
          <span v-else class="bench-value bench-pending">…</span>
        </div>
        <p v-if="states[s.id]!.status === 'done'" class="bench-prepare">
          {{ ui.prepare }} — Typeflow:
          {{
            fmtMs(
              states[s.id]!.results.find((r) => r.engine === 'tf')!.prepareMs!,
            )
          }}, JSONata:
          {{
            fmtMs(
              states[s.id]!.results.find((r) => r.engine === 'jn')!.prepareMs!,
            )
          }}, jq:
          {{
            fmtMs(
              states[s.id]!.results.find((r) => r.engine === 'jq')!.prepareMs!,
            )
          }}
          · {{ ui.verified }}
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.bench {
  /* Categorical engine palette — validated for CVD + contrast (light). */
  --bench-js: #0d9488;
  --bench-tf: #3451b2;
  --bench-jq: #7c3aed;
  --bench-jn: #b45309;
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin: 24px 0;
}
:global(.dark) .bench {
  /* Dark-mode steps validated against the dark surface — not a naive flip. */
  --bench-js: #0d9488;
  --bench-tf: #5c7cfa;
  --bench-jq: #a78bfa;
  --bench-jn: #d97706;
}
.bench-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  padding: 18px 20px 16px;
}
.bench-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  border: none;
  padding: 0;
}
.bench-note {
  margin: 4px 0 14px;
  font-size: 13.5px;
  color: var(--vp-c-text-2);
  max-width: 72ch;
}
.bench-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: -1px;
}
.bench-tab {
  font-size: 12.5px;
  padding: 4px 14px;
  border: 1px solid var(--vp-c-divider);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.bench-tab.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.bench-code {
  margin: 0 0 14px;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0 8px 8px 8px;
  background: var(--vp-c-bg);
  font-family: var(--vp-font-family-mono), monospace;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
  max-height: 320px;
}
.bench-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.bench-size-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--vp-c-text-3);
}
.bench-sizes {
  display: flex;
  gap: 6px;
}
.bench-chip {
  font-size: 12.5px;
  padding: 2px 12px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.bench-chip.active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.bench-chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.bench-run {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  padding: 5px 18px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  cursor: pointer;
  transition: opacity 0.15s;
}
.bench-run:hover:not(:disabled) {
  opacity: 0.85;
}
.bench-run:disabled {
  opacity: 0.55;
  cursor: default;
}
.bench-error {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--vp-c-red-1);
}
.bench-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bench-row {
  display: grid;
  grid-template-columns: 110px 1fr minmax(190px, auto);
  align-items: center;
  gap: 12px;
}
.bench-row.measuring .bench-name {
  color: var(--vp-c-brand-1);
}
.bench-name {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}
.bench-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}
.sw-tf {
  background: var(--bench-tf);
}
.sw-jq {
  background: var(--bench-jq);
}
.sw-jn {
  background: var(--bench-jn);
}
.sw-js {
  background: var(--bench-js);
}
.bench-track {
  display: block;
  height: 14px;
  border-radius: 4px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.bench-bar {
  display: block;
  height: 100%;
  border-radius: 0 4px 4px 0;
  transition: width 0.35s ease;
}
@media (prefers-reduced-motion: reduce) {
  .bench-bar {
    transition: none;
  }
}
.bar-tf {
  background: var(--bench-tf);
}
.bar-jq {
  background: var(--bench-jq);
}
.bar-jn {
  background: var(--bench-jn);
}
.bar-js {
  background: var(--bench-js);
}
.bench-value {
  font-size: 13px;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bench-value strong {
  font-weight: 700;
}
.bench-pending {
  color: var(--vp-c-text-3);
}
.bench-fastest {
  font-style: normal;
  font-size: 11px;
  margin-left: 6px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
  font-weight: 600;
}
.bench-rel {
  font-style: normal;
  font-size: 12px;
  margin-left: 6px;
  color: var(--vp-c-text-3);
}
.bench-prepare {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
@media (max-width: 560px) {
  .bench-row {
    grid-template-columns: 90px 1fr;
  }
  .bench-value {
    grid-column: 2;
  }
}
</style>
