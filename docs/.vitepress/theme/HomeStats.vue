<script setup lang="ts">
import { BUILTIN_GROUPS } from '../../../src/builtins/index';
import { computed } from 'vue';
import { DIAGNOSTICS } from '../../../scripts/doc-pages/diagnostics';
import { DOC_PAGES } from '../../../scripts/doc-pages/index';
import { useData } from 'vitepress';

// Every number on this strip is computed from the same source of truth the
// compiler uses — it cannot drift from the implementation.
const fns = BUILTIN_GROUPS.reduce(
  (n, g) => n + Object.keys(g.functions).length,
  0,
);
const ops = DOC_PAGES.reduce((n, p) => n + p.items.length, 0);
const diags = DIAGNOSTICS.length;

const { lang } = useData();
const stats = computed(() =>
  lang.value === 'fr'
    ? [
        {
          n: String(fns),
          label: 'fonctions natives',
          sub: 'typées, documentées, vivantes',
        },
        {
          n: String(ops),
          label: 'opérateurs & constructions',
          sub: 'chacun avec un playground',
        },
        {
          n: String(diags),
          label: 'diagnostics',
          sub: 'documentés avec repros vivantes',
        },
        {
          n: '0',
          label: 'dépendance du runtime',
          sub: 'Node, Bun, navigateurs, CI',
        },
      ]
    : [
        {
          n: String(fns),
          label: 'builtin functions',
          sub: 'typed, documented, live',
        },
        {
          n: String(ops),
          label: 'operators & constructs',
          sub: 'each with a playground',
        },
        {
          n: String(diags),
          label: 'diagnostics',
          sub: 'documented with live repros',
        },
        {
          n: '0',
          label: 'runtime dependencies',
          sub: 'Node, Bun, browsers, CI',
        },
      ],
);
</script>

<template>
  <div class="hs">
    <div v-for="s in stats" :key="s.label" class="hs-item">
      <div class="hs-n">{{ s.n }}</div>
      <div class="hs-label">{{ s.label }}</div>
      <div class="hs-sub">{{ s.sub }}</div>
    </div>
  </div>
</template>

<style scoped>
.hs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin: 32px 0;
}
.hs-item {
  padding: 20px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-align: center;
}
.hs-n {
  font-size: 34px;
  font-weight: 800;
  line-height: 1.1;
  background: linear-gradient(120deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hs-label {
  margin-top: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.hs-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
