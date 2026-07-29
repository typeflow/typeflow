<script setup lang="ts">
import {
  compile,
  createMapping,
  type Diagnostic,
  offsetToLineCol,
  typeToString,
} from 'typeflowjs';
import { computed, ref } from 'vue';
import { highlightJson, highlightTypeflow } from './highlight';
import { useData, withBase } from 'vitepress';
import CodeEditor from './CodeEditor.vue';
import { DEMO_FUNCTIONS } from './demo-functions';
import { encodePlaygroundState } from './share';

const props = defineProps<{ mapping: string; input: string }>();

const { lang } = useData();
const ui = computed(() =>
  lang.value === 'fr'
    ? {
        mapping: 'Mapping',
        input: "JSON d'entrée",
        output: 'Sortie',
        inferredType: 'type inféré',
        reset: 'Réinitialiser',
        open: 'Playground ↗',
        openTitle: 'Ouvrir cet exemple dans le playground',
        invalid: 'invalide',
        hint: 'indice',
        badJson: "// L'entrée n'est pas du JSON valide :",
        fixErrors: '// Corrigez les erreurs du mapping pour voir la sortie.',
        runtimeError: "// Erreur d'exécution :",
      }
    : {
        mapping: 'Mapping',
        input: 'Input JSON',
        output: 'Output',
        inferredType: 'inferred type',
        reset: 'Reset',
        open: 'Playground ↗',
        openTitle: 'Open this example in the playground',
        invalid: 'invalid',
        hint: 'hint',
        badJson: '// Input is not valid JSON:',
        fixErrors: '// Fix the mapping errors to see the output.',
        runtimeError: '// Runtime error:',
      },
);

const initialMapping = decodeURIComponent(props.mapping).trimEnd();
const initialInput = decodeURIComponent(props.input).trimEnd();

const mappingText = ref(initialMapping);
const inputText = ref(initialInput);

const dirty = computed(
  () =>
    mappingText.value !== initialMapping || inputText.value !== initialInput,
);

function reset() {
  mappingText.value = initialMapping;
  inputText.value = initialInput;
}

const compiled = computed(() =>
  compile(mappingText.value, { fileName: 'example.typeflow' }),
);

interface UiDiagnostic {
  line: number;
  col: number;
  severity: string;
  code: string;
  message: string;
  hint?: string;
}

const diagnostics = computed<UiDiagnostic[]>(() =>
  compiled.value.diagnostics.map((d: Diagnostic) => {
    const { line, col } = offsetToLineCol(mappingText.value, d.span.start);
    return {
      line,
      col,
      severity: d.severity,
      code: d.code,
      message: d.message,
      hint: d.hint,
    };
  }),
);

const errorCount = computed(
  () => diagnostics.value.filter((d) => d.severity === 'error').length,
);

const inferredType = computed(() =>
  compiled.value.outputType
    ? typeToString(compiled.value.outputType)
    : 'unknown',
);

const inputError = computed(() => {
  try {
    JSON.parse(inputText.value);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
});

const output = computed(() => {
  if (inputError.value) return `${ui.value.badJson}\n// ${inputError.value}`;
  if (errorCount.value > 0 || !compiled.value.compiled) {
    return ui.value.fixErrors;
  }
  try {
    const result = createMapping(compiled.value.compiled, {
      functions: DEMO_FUNCTIONS,
    })(JSON.parse(inputText.value));
    return JSON.stringify(result, null, 2) ?? 'undefined';
  } catch (e) {
    return `${ui.value.runtimeError} ${e instanceof Error ? e.message : String(e)}`;
  }
});

const outputHtml = computed(() => highlightJson(output.value));

// Size editors to their content so short examples stay short.
const LINE_HEIGHT = 20.8; // 13px font * 1.6 line-height
const V_PADDING = 24;
function editorHeight(text: string): string {
  const lines = text.split('\n').length + 1;
  return `${Math.round(Math.max(4, lines) * LINE_HEIGHT + V_PADDING)}px`;
}
const mappingHeight = computed(() => editorHeight(mappingText.value));
const inputHeight = computed(() => editorHeight(inputText.value));

// Deep link into the full playground, carrying the CURRENT editor state.
const playgroundHref = computed(() =>
  withBase(
    `${lang.value === 'fr' ? '/fr' : ''}/playground#code=${encodePlaygroundState(mappingText.value, inputText.value)}`,
  ),
);
</script>

<template>
  <div class="mp">
    <section class="mp-pane">
      <header>
        <span>{{ ui.mapping }}</span>
        <span class="mp-status" :class="errorCount ? 'bad' : 'good'">
          {{ errorCount ? `✖ ${errorCount}` : '✔' }}
        </span>
        <span class="mp-tools">
          <button v-if="dirty" class="mp-reset" @click="reset">
            {{ ui.reset }}
          </button>
          <a
            class="mp-reset mp-open"
            :href="playgroundHref"
            :title="ui.openTitle"
            target="_blank"
            rel="noopener">
            {{ ui.open }}
          </a>
        </span>
      </header>
      <div class="mp-editor" :style="{ height: mappingHeight }">
        <CodeEditor v-model="mappingText" :highlight="highlightTypeflow" />
      </div>
    </section>

    <div class="mp-cols">
      <section class="mp-pane">
        <header>
          <span>{{ ui.input }}</span>
          <span v-if="inputError" class="mp-status bad">{{ ui.invalid }}</span>
        </header>
        <div class="mp-editor" :style="{ height: inputHeight }">
          <CodeEditor v-model="inputText" :highlight="highlightJson" />
        </div>
      </section>
      <section class="mp-pane">
        <header>
          <span>{{ ui.output }}</span>
        </header>
        <pre class="mp-output" v-html="outputHtml"></pre>
      </section>
    </div>

    <div class="mp-type">
      <span class="mp-type-label">{{ ui.inferredType }}</span>
      <code>{{ inferredType }}</code>
    </div>

    <ul v-if="diagnostics.length" class="mp-diagnostics">
      <li v-for="(d, i) in diagnostics" :key="i" :class="d.severity">
        <span class="mp-pos">{{ d.line }}:{{ d.col }}</span>
        <span class="mp-sev">{{ d.severity }}</span>
        <span class="mp-code">{{ d.code }}</span>
        <span class="mp-msg">{{ d.message }}</span>
        <div v-if="d.hint" class="mp-hint">{{ ui.hint }}: {{ d.hint }}</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0 24px;
}
.mp-pane {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
}
.mp-pane header {
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
.mp-status {
  font-size: 11px;
  padding: 0 8px;
  border-radius: 999px;
  text-transform: none;
  letter-spacing: normal;
}
.mp-status.good {
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}
.mp-status.bad {
  background: var(--vp-c-red-soft);
  color: var(--vp-c-red-1);
}
.mp-tools {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.mp-reset {
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
.mp-reset:hover {
  border-color: var(--vp-c-brand-1);
}
a.mp-open {
  text-decoration: none !important;
  color: var(--vp-c-text-1) !important;
  font-weight: 400;
}
.mp-editor {
  display: flex;
  position: relative;
}
.mp-editor :deep(.ce-wrap) {
  min-height: 0;
}
.mp-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
@media (max-width: 640px) {
  .mp-cols {
    grid-template-columns: 1fr;
  }
}
.mp-output {
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
.mp-type {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  padding: 0 2px;
}
.mp-type-label {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  font-size: 10px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}
.mp-type code {
  background: transparent;
  padding: 0;
  color: var(--vp-c-brand-1);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.mp-diagnostics {
  margin: 0 !important;
  padding: 4px 0 !important;
  list-style: none !important;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.mp-diagnostics li {
  padding: 3px 12px;
  font-family: var(--vp-font-family-mono), monospace;
  font-size: 12.5px;
  margin: 0 !important;
}
.mp-diagnostics li + li {
  border-top: 1px dashed var(--vp-c-divider);
}
.mp-pos {
  color: var(--vp-c-text-3);
  margin-right: 8px;
}
.mp-sev {
  font-weight: 600;
  margin-right: 8px;
}
li.error .mp-sev {
  color: var(--vp-c-red-1);
}
li.warning .mp-sev {
  color: var(--vp-c-yellow-1);
}
.mp-code {
  color: var(--vp-c-text-3);
  margin-right: 8px;
}
.mp-hint {
  color: var(--vp-c-text-2);
  padding-left: 16px;
}
</style>
