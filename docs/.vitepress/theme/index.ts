import './tokens.css';
import './custom.css';
import Benchmark from './Benchmark.vue';
import DefaultTheme from 'vitepress/theme';
import FnIndex from './FnIndex.vue';
import FnSignature from './FnSignature.vue';
import HomeStats from './HomeStats.vue';
import JqPlayground from './JqPlayground.vue';
import JsonataPlayground from './JsonataPlayground.vue';
import MiniPlayground from './MiniPlayground.vue';
import Playground from './Playground.vue';
import { type Theme } from 'vitepress';

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router }) {
    app.component('Playground', Playground);
    app.component('MiniPlayground', MiniPlayground);
    app.component('JsonataPlayground', JsonataPlayground);
    app.component('JqPlayground', JqPlayground);
    app.component('Benchmark', Benchmark);
    app.component('FnIndex', FnIndex);
    app.component('FnSignature', FnSignature);
    app.component('HomeStats', HomeStats);

    // Accordion sidebar: on navigation, collapse any open group that doesn't
    // contain the new page. VitePress already auto-opens the group holding
    // the active link (`has-active`), so only the stale ones are closed.
    if (typeof window !== 'undefined') {
      const previous = router.onAfterRouteChanged;
      router.onAfterRouteChanged = async (to) => {
        await previous?.(to);
        // Wait two frames so the sidebar has re-rendered its `has-active`
        // state before deciding which groups are stale.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const stale = document.querySelectorAll<HTMLElement>(
              '.VPSidebarItem.level-1.collapsible:not(.collapsed):not(.has-active)',
            );
            for (const group of stale) {
              group
                .querySelector<HTMLElement>(':scope > .item > .caret')
                ?.click();
            }
          }),
        );
      };
    }
  },
} satisfies Theme;
