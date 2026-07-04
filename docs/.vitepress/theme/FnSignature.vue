<script setup lang="ts">
import { computed } from 'vue';
import { highlightTypeflow } from './highlight';

// `code` is URI-encoded by the generator so quotes survive the attribute.
const props = defineProps<{ code: string }>();
const html = computed(() => highlightTypeflow(decodeURIComponent(props.code)));
</script>

<template>
  <div class="fn-sig">
    <code v-html="html"></code>
  </div>
</template>

<style scoped>
.fn-sig {
  margin: 10px 0 14px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-left: 3px solid var(--vp-c-brand-1);
  overflow-x: auto;
}
.fn-sig code {
  background: transparent;
  padding: 0;
  font-size: 14px;
  white-space: pre;
  color: var(--vp-c-text-1);
}
</style>
