<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  modelValue: string;
  highlight: (source: string) => string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const textarea = ref<HTMLTextAreaElement>();
const backdrop = ref<HTMLElement>();

// Trailing newline so the highlighted <pre> keeps the same height as the textarea.
const html = computed(() => props.highlight(props.modelValue) + "\n");

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
}

function onScroll() {
  if (!textarea.value || !backdrop.value) return;
  backdrop.value.scrollTop = textarea.value.scrollTop;
  backdrop.value.scrollLeft = textarea.value.scrollLeft;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const el = textarea.value!;
  const { selectionStart, selectionEnd, value } = el;
  const next = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
  emit("update:modelValue", next);
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = selectionStart + 2;
  });
}
</script>

<template>
  <div class="ce-wrap">
    <pre ref="backdrop" class="ce-backdrop" aria-hidden="true"><code v-html="html"></code></pre>
    <textarea
      ref="textarea"
      class="ce-input"
      :value="modelValue"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      @input="onInput"
      @scroll="onScroll"
      @keydown="onKeydown"
    />
  </div>
</template>

<style scoped>
.ce-wrap {
  position: relative;
  flex: 1;
  min-height: 200px;
  background: var(--vp-c-bg);
}
.ce-backdrop,
.ce-input {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 12px;
  font-family: var(--vp-font-family-mono), monospace;
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
  border: none;
}
.ce-backdrop {
  pointer-events: none;
  overflow: hidden;
  color: var(--vp-c-text-1);
  background: transparent;
}
.ce-backdrop code {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  background: transparent;
  padding: 0;
}
.ce-input {
  resize: none;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--vp-c-text-1);
}
.ce-input::selection {
  background: var(--vp-c-brand-soft);
}
</style>
