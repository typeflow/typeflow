<script setup lang="ts">
import { computed, ref } from 'vue';
import CodeEditor from './CodeEditor.vue';
import { convertJsonata } from '@thomasfarineau/typeflow-converter';
import { highlightTypeflow } from './highlight';

const DEFAULT_JSONATA = `{
  "fullName": firstName & " " & lastName,
  "ref": "user-" & id,
  "expensive": products[price > 100].name,
  "catalog": products.{ "label": $uppercase(name), "price": price },
  "total": $sum(products.price)
}`;

const jsonataText = ref(DEFAULT_JSONATA);

const dirty = computed(() => jsonataText.value !== DEFAULT_JSONATA);

function reset() {
  jsonataText.value = DEFAULT_JSONATA;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const highlightJsonata = (source: string) => escapeHtml(source);

const converted = computed(() => convertJsonata(jsonataText.value));

const typeflowHtml = computed(() =>
  converted.value.ok
    ? highlightTypeflow(converted.value.typeflow.trimEnd())
    : escapeHtml('# Fix the JSONata to see the conversion.'),
);

const LINE_HEIGHT = 20.8;
const V_PADDING = 24;
const jsonataHeight = computed(() => {
  const lines = jsonataText.value.split('\n').length + 1;
  return `${Math.round(Math.max(4, lines) * LINE_HEIGHT + V_PADDING)}px`;
});
</script>

<template>
  <div class="jp">
    <div class="jp-cols">
      <section class="jp-pane">
        <header>
          <span>JSONata</span>
          <span
            class="jp-status"
            :class="converted.errors.length ? 'bad' : 'good'">
            {{ converted.errors.length ? '✖' : '✔' }}
          </span>
          <button v-if="dirty" class="jp-reset" @click="reset">Reset</button>
        </header>
        <div class="jp-editor" :style="{ height: jsonataHeight }">
          <CodeEditor v-model="jsonataText" :highlight="highlightJsonata" />
        </div>
      </section>
      <section class="jp-pane">
        <header><span>Typeflow (converted live)</span></header>
        <pre class="jp-output" v-html="typeflowHtml"></pre>
      </section>
    </div>

    <ul
      v-if="converted.errors.length || converted.notes.length"
      class="jp-msgs">
      <li v-for="(e, i) in converted.errors" :key="`e${i}`" class="error">
        {{ e }}
      </li>
      <li v-for="(n, i) in converted.notes" :key="`n${i}`" class="note">
        {{ n }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.jp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0 24px;
}
.jp-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
@media (max-width: 640px) {
  .jp-cols {
    grid-template-columns: 1fr;
  }
}
.jp-pane {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
}
.jp-pane header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
}
.jp-status {
  font-size: 11px;
  padding: 0 8px;
  border-radius: 999px;
  text-transform: none;
}
.jp-status.good {
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}
.jp-status.bad {
  background: var(--vp-c-red-soft);
  color: var(--vp-c-red-1);
}
.jp-reset {
  margin-left: auto;
  font-size: 11px;
  padding: 1px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  text-transform: none;
  letter-spacing: normal;
}
.jp-reset:hover {
  border-color: var(--vp-c-brand-1);
}
.jp-editor {
  display: flex;
  position: relative;
}
.jp-editor :deep(.ce-wrap) {
  min-height: 0;
}
.jp-output {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono), monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
  min-height: 60px;
}
.jp-msgs {
  margin: 0 !important;
  padding: 4px 0 !important;
  list-style: none !important;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.jp-msgs li {
  padding: 3px 12px;
  font-size: 12.5px;
  margin: 0 !important;
}
.jp-msgs li + li {
  border-top: 1px dashed var(--vp-c-divider);
}
.jp-msgs li.error {
  color: var(--vp-c-red-1);
}
.jp-msgs li.note {
  color: var(--vp-c-text-2);
}
</style>
