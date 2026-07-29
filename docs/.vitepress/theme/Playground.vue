<script setup lang="ts">
import {
  compile,
  createMapping,
  type Diagnostic,
  format,
  offsetToLineCol,
  typeToString,
} from 'typeflowjs';
import { computed, onMounted, ref } from 'vue';
import { decodePlaygroundState, encodePlaygroundState } from './share';
import { highlightJson, highlightTypeflow } from './highlight';
import CodeEditor from './CodeEditor.vue';
import { DEMO_FUNCTIONS } from './demo-functions';
import { useData } from 'vitepress';

const DEFAULT_MAPPING = `# The playground uses inline input declarations.
# (In a project, bind a TypeScript type: input user: ApiUser from "./types")
input user: {
  id: number,
  firstName: string,
  lastName: string,
  role: "admin" | "member" | "guest",
  contact?: { email?: string },
  labels: { name: string, active: boolean }[],
  scores: number[],
}

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  isAdmin: user.role == "admin",
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
  totalScore: sum(user.scores),
}
`;

const DEFAULT_INPUT = `{
  "id": 42,
  "firstName": "Ada",
  "lastName": "Lovelace",
  "role": "admin",
  "contact": {},
  "labels": [
    { "name": "founder", "active": true },
    { "name": "legacy", "active": false },
    { "name": "math", "active": true }
  ],
  "scores": [10, 20, 12]
}
`;

const mappingText = ref(DEFAULT_MAPPING);
const inputText = ref(DEFAULT_INPUT);

const compiled = computed(() =>
  compile(mappingText.value, { fileName: 'playground.typeflow' }),
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
  if (inputError.value)
    return `// Input is not valid JSON:\n// ${inputError.value}`;
  if (errorCount.value > 0 || !compiled.value.compiled) {
    return '// Fix the mapping errors to see the output.';
  }
  try {
    const result = createMapping(compiled.value.compiled, {
      functions: DEMO_FUNCTIONS,
    })(JSON.parse(inputText.value));
    return JSON.stringify(result, null, 2) ?? 'undefined';
  } catch (e) {
    return `// Runtime error: ${e instanceof Error ? e.message : String(e)}`;
  }
});

const outputHtml = computed(() => highlightJson(output.value));

function formatAll() {
  const result = format(mappingText.value);
  if (result.ok) mappingText.value = result.formatted;
  if (!inputError.value) {
    inputText.value =
      JSON.stringify(JSON.parse(inputText.value), null, 2) + '\n';
  }
}

function reset() {
  mappingText.value = DEFAULT_MAPPING;
  inputText.value = DEFAULT_INPUT;
}

// Deep links: `#code=…` seeds the editors (used by the "open in playground"
// buttons on doc examples), and Share copies a URL reproducing this state.
onMounted(() => {
  const state = decodePlaygroundState(location.hash);
  if (state) {
    mappingText.value = state.mapping;
    inputText.value = state.input;
  }
});

const justShared = ref(false);
async function share() {
  const hash = `#code=${encodePlaygroundState(mappingText.value, inputText.value)}`;
  history.replaceState(null, '', hash);
  await navigator.clipboard.writeText(location.href);
  justShared.value = true;
  setTimeout(() => (justShared.value = false), 2000);
}

const { lang } = useData();
const ui = computed(() =>
  lang.value === 'fr'
    ? {
        errors: (n: number) => `✖ ${n} erreur(s)`,
        noErrors: '✔ aucune erreur',
        format: 'Formater',
        share: 'Partager',
        shared: 'Lien copié ✔',
        reset: "Réinitialiser l'exemple",
        input: "JSON d'entrée",
        invalid: 'invalide',
        mapping: 'Mapping (.typeflow)',
        output: 'Sortie',
        inferred: 'Type de sortie inféré',
        hint: 'indice',
      }
    : {
        errors: (n: number) => `✖ ${n} error(s)`,
        noErrors: '✔ no errors',
        format: 'Format',
        share: 'Share',
        shared: 'Link copied ✔',
        reset: 'Reset example',
        input: 'Input JSON',
        invalid: 'invalid',
        mapping: 'Mapping (.typeflow)',
        output: 'Output',
        inferred: 'Inferred output type',
        hint: 'hint',
      },
);
</script>

<template>
  <div class="tf-playground">
    <div class="tf-toolbar">
      <div class="tf-title">
        <strong>Typeflow Playground</strong>
        <span class="tf-status" :class="errorCount ? 'bad' : 'good'">
          {{ errorCount ? ui.errors(errorCount) : ui.noErrors }}
        </span>
      </div>
      <div class="tf-actions">
        <button class="tf-btn tf-primary" @click="formatAll">
          {{ ui.format }}
        </button>
        <button
          class="tf-btn"
          :class="{ 'tf-shared': justShared }"
          @click="share">
          {{ justShared ? ui.shared : ui.share }}
        </button>
        <button class="tf-btn" @click="reset">{{ ui.reset }}</button>
      </div>
    </div>

    <div class="tf-grid">
      <section class="tf-pane">
        <header>
          {{ ui.input }}
          <span v-if="inputError" class="tf-badge bad">{{ ui.invalid }}</span>
        </header>
        <CodeEditor v-model="inputText" :highlight="highlightJson" />
      </section>

      <section class="tf-pane">
        <header>{{ ui.mapping }}</header>
        <CodeEditor v-model="mappingText" :highlight="highlightTypeflow" />
      </section>

      <section class="tf-pane">
        <header>{{ ui.output }}</header>
        <pre class="tf-output" v-html="outputHtml"></pre>
        <header class="tf-subheader">{{ ui.inferred }}</header>
        <pre class="tf-output tf-type">{{ inferredType }}</pre>
      </section>
    </div>

    <section v-if="diagnostics.length" class="tf-diagnostics">
      <header>Diagnostics</header>
      <ul>
        <li v-for="(d, i) in diagnostics" :key="i" :class="d.severity">
          <span class="tf-pos">{{ d.line }}:{{ d.col }}</span>
          <span class="tf-sev">{{ d.severity }}</span>
          <span class="tf-code">{{ d.code }}</span>
          <span class="tf-msg">{{ d.message }}</span>
          <div v-if="d.hint" class="tf-hint">{{ ui.hint }}: {{ d.hint }}</div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.tf-playground {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 32px;
  max-width: 1600px;
  margin: 0 auto;
  width: 100%;
}
.tf-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tf-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
}
.tf-status {
  font-size: 13px;
  padding: 2px 10px;
  border-radius: 999px;
}
.tf-status.good {
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}
.tf-status.bad {
  background: var(--vp-c-red-soft);
  color: var(--vp-c-red-1);
}
.tf-actions {
  display: flex;
  gap: 8px;
}
.tf-shared {
  border-color: var(--vp-c-green-1);
  color: var(--vp-c-green-1);
}
.tf-btn {
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.tf-btn:hover {
  border-color: var(--vp-c-brand-1);
}
.tf-primary {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: transparent;
}
.tf-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  gap: 12px;
}
@media (max-width: 960px) {
  .tf-grid {
    grid-template-columns: 1fr;
  }
}
.tf-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  min-height: 480px;
}
.tf-pane header,
.tf-diagnostics header {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  display: flex;
  align-items: center;
  gap: 8px;
}
.tf-subheader {
  border-top: 1px solid var(--vp-c-divider);
}
.tf-badge.bad {
  background: var(--vp-c-red-soft);
  color: var(--vp-c-red-1);
  border-radius: 999px;
  padding: 0 8px;
  text-transform: none;
  letter-spacing: normal;
}
.tf-output {
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
  min-height: 100px;
}
.tf-type {
  flex: 0 1 auto;
  color: var(--vp-c-brand-1);
}
.tf-diagnostics {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.tf-diagnostics ul {
  margin: 0;
  padding: 8px 0;
  list-style: none;
}
.tf-diagnostics li {
  padding: 4px 12px;
  font-family: var(--vp-font-family-mono), monospace;
  font-size: 13px;
  display: block;
}
.tf-diagnostics li + li {
  border-top: 1px dashed var(--vp-c-divider);
}
.tf-pos {
  color: var(--vp-c-text-3);
  margin-right: 8px;
}
.tf-sev {
  font-weight: 600;
  margin-right: 8px;
}
li.error .tf-sev {
  color: var(--vp-c-red-1);
}
li.warning .tf-sev {
  color: var(--vp-c-yellow-1);
}
.tf-code {
  color: var(--vp-c-text-3);
  margin-right: 8px;
}
.tf-hint {
  color: var(--vp-c-text-2);
  padding-left: 16px;
}
</style>
