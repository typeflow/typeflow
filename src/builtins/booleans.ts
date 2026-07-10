import { type Builtin, type BuiltinGroup, pAny } from './types';
import { effectiveBoolean } from './values';
import { T } from '#core';

const functions: Record<string, Builtin> = {
  boolean: {
    signature: 'boolean(value: unknown): boolean',
    doc: 'JSONata truthiness: `""`, `0`, `[]` and `{}` are false.',
    example: `hasBio: boolean(user.bio)`,
    params: [pAny()],
    result: T.boolean,
    impl: ([v]) => effectiveBoolean(v),
  },
  not: {
    signature: 'not(value: unknown): boolean',
    doc: 'Negated JSONata truthiness.',
    example: `isBlank: not(user.bio)`,
    params: [pAny()],
    result: T.boolean,
    impl: ([v]) => !effectiveBoolean(v),
  },
  exists: {
    signature: 'exists(value: unknown): boolean',
    doc: 'True unless the value is `undefined` (`null` exists).',
    example: `wasDeleted: exists(user.deletedAt)`,
    params: [pAny()],
    result: T.boolean,
    impl: ([v]) => v !== undefined,
  },
};

/** Booleans — see the generated docs section of the same name. */
export const booleans: BuiltinGroup = {
  id: 'booleans',
  title: 'Booleans',
  doc: "`boolean` applies JSONata truthiness (empty strings, `0`, empty arrays/objects are false); `not` negates it; `exists` is true for any value that isn't `undefined` (including `null`).",
  example: {
    mapping: `input user: { bio: string, tags: string[], deletedAt: null }

map {
  hasBio: boolean(user.bio),
  hasTags: boolean(user.tags),
  isBlank: not(user.bio),
  wasDeleted: exists(user.deletedAt),
}`,
    input: `{ "bio": "", "tags": ["a"], "deletedAt": null }`,
  },
  functions,
};
