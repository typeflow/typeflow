<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  FR_FUNCTION_DOCS,
  FR_FUNCTION_GROUPS,
} from '../../../scripts/doc-pages/i18n/fr-functions';
import { useData, withBase } from 'vitepress';
import { BUILTIN_GROUPS } from '../../../src/builtins/index';
import { highlightTypeflow } from './highlight';

/**
 * Searchable index of every builtin, generated from src/builtins at build
 * time — the same objects the compiler checks against, so it can't drift.
 * `group` limits the grid to one group (used as the per-page "at a glance");
 * without it the full searchable index is rendered.
 */
const props = withDefaults(
  defineProps<{ group?: string; search?: boolean }>(),
  { search: true },
);

interface Entry {
  name: string;
  signature: string;
  doc: string;
  group: string;
  groupTitle: string;
  category: string;
}

const { lang } = useData();
const isFr = computed(() => lang.value === 'fr');

// Same data source as the compiler; docs/labels swap with the site locale.
const ALL = computed<Entry[]>(() =>
  BUILTIN_GROUPS.flatMap((g) =>
    Object.entries(g.functions).map(([name, b]) => ({
      name,
      signature: b.signature,
      doc: (isFr.value ? FR_FUNCTION_DOCS[name] : b.doc) ?? b.doc ?? '',
      group: g.id,
      groupTitle: isFr.value
        ? (FR_FUNCTION_GROUPS[g.id]?.title ?? g.title)
        : g.title,
      category: isFr.value
        ? (FR_FUNCTION_GROUPS[g.id]?.categories?.[b.category ?? ''] ?? '')
        : (b.category ?? ''),
    })),
  ),
);

const ui = computed(() =>
  isFr.value
    ? {
        placeholder: 'Rechercher une fonction… (nom, signature, description)',
        aria: 'Rechercher une fonction',
        count: 'fonctions',
        empty: 'Aucune fonction ne correspond à',
      }
    : {
        placeholder: 'Search a function… (name, signature, description)',
        aria: 'Search functions',
        count: 'functions',
        empty: 'No function matches',
      },
);

const query = ref('');
const activeGroup = ref('');
const groups = computed(() =>
  BUILTIN_GROUPS.map((g) => ({
    id: g.id,
    title: isFr.value ? (FR_FUNCTION_GROUPS[g.id]?.title ?? g.title) : g.title,
    count: Object.keys(g.functions).length,
  })),
);

const entries = computed(() => {
  let list = props.group
    ? ALL.value.filter((e) => e.group === props.group)
    : ALL.value;
  if (!props.group && activeGroup.value) {
    list = list.filter((e) => e.group === activeGroup.value);
  }
  const q = query.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.doc.toLowerCase().includes(q) ||
        e.signature.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.groupTitle.toLowerCase().includes(q),
    );
  }
  return list;
});

function link(e: Entry): string {
  return withBase(`${isFr.value ? '/fr' : ''}/functions/${e.group}#${e.name}`);
}
function toggleGroup(id: string): void {
  activeGroup.value = activeGroup.value === id ? '' : id;
}
</script>

<template>
  <div class="fni">
    <template v-if="search">
      <div class="fni-controls">
        <input
          v-model="query"
          class="fni-search"
          type="search"
          :placeholder="ui.placeholder"
          :aria-label="ui.aria" />
        <span class="fni-count"
          >{{ entries.length }} / {{ ALL.length }} {{ ui.count }}</span
        >
      </div>
      <div v-if="!props.group" class="fni-chips">
        <button
          v-for="g in groups"
          :key="g.id"
          class="fni-chip"
          :class="{ active: activeGroup === g.id }"
          @click="toggleGroup(g.id)">
          {{ g.title }} <span class="fni-chip-n">{{ g.count }}</span>
        </button>
      </div>
    </template>

    <div class="fni-grid">
      <a v-for="e in entries" :key="e.name" class="fni-card" :href="link(e)">
        <div class="fni-head">
          <span class="fni-name">{{ e.name }}</span>
          <span class="fni-tag">{{ e.category || e.groupTitle }}</span>
        </div>
        <code class="fni-sig" v-html="highlightTypeflow(e.signature)"></code>
        <p v-if="e.doc" class="fni-doc">{{ e.doc }}</p>
      </a>
    </div>
    <p v-if="entries.length === 0" class="fni-empty">
      {{ ui.empty }} “{{ query }}”.
    </p>
  </div>
</template>

<style scoped>
.fni {
  margin: 20px 0;
}
.fni-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.fni-search {
  flex: 1;
  padding: 9px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.fni-search:focus {
  border-color: var(--vp-c-brand-1);
}
.fni-count {
  font-size: 12px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}
.fni-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}
.fni-chip {
  font-size: 12.5px;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}
.fni-chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
.fni-chip.active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.fni-chip-n {
  opacity: 0.6;
  font-size: 11px;
}
.fni-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 10px;
}
.fni-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.15s,
    transform 0.15s,
    box-shadow 0.15s;
}
.fni-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}
.fni-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.fni-name {
  font-family: var(--vp-font-family-mono), monospace;
  font-weight: 700;
  font-size: 14px;
  color: var(--vp-c-brand-1);
}
.fni-tag {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}
.fni-sig {
  display: block;
  background: transparent;
  padding: 0;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
  overflow-x: auto;
  white-space: pre;
}
.fni-doc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fni-empty {
  color: var(--vp-c-text-3);
  font-size: 14px;
  padding: 16px 4px;
}
</style>
