/**
 * The Typeflow standard library: JSONata's function set, minus anything that
 * takes a lambda (covered by `->`, `[filter]`, and `use` TS functions), and
 * minus $eval / XPath picture strings.
 *
 * Each builtin is defined ONCE (in its category file) with its type signature,
 * runtime implementation, and reference doc; each category carries its own
 * section prose and playground example. The compiler checks calls against
 * `params`/`result`, the runtime executes `impl`, and the docs pages
 * (docs/functions/*.md) are generated from these groups by
 * scripts/generate-docs — nothing is written by hand on the docs side.
 */
import { type Builtin, type BuiltinGroup } from './types';
import { aggregation } from './aggregation';
import { arrays } from './arrays';
import { booleans } from './booleans';
import { datetime } from './datetime';
import { numbers } from './numbers';
import { objects } from './objects';
import { strings } from './strings';

export {
  isBooleanish,
  isNumberish,
  isStringish,
  type Builtin,
  type BuiltinGroup,
  type BuiltinParam,
} from './types';

export const BUILTIN_GROUPS: BuiltinGroup[] = [
  strings,
  numbers,
  aggregation,
  booleans,
  arrays,
  objects,
  datetime,
];

export const BUILTINS: Record<string, Builtin> = Object.assign(
  {},
  ...BUILTIN_GROUPS.map((g) => g.functions),
);
