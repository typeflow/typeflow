/** All declared documentation pages, in sidebar order. */
import { arithmetic } from './pages/arithmetic';
import { arrays } from './pages/arrays';
import { bindings } from './pages/bindings';
import { comparisons } from './pages/comparisons';
import { conditionals } from './pages/conditionals';
import { literals } from './pages/literals';
import { paths } from './pages/paths';
import { projection } from './pages/projection';

export type { DocExample, DocItem, DocPage } from './types';

export const DOC_PAGES = [
  literals,
  paths,
  arithmetic,
  comparisons,
  conditionals,
  arrays,
  projection,
  bindings,
].toSorted((a, b) => a.order - b.order);
