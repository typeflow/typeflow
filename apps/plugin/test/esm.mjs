// Exercises `import ... from '*.typeflow'` (Node with --import
// @typeflowjs/plugin/register, or Bun with --preload @typeflowjs/plugin/bun).
import assert from 'node:assert/strict';
import mapUser from './fixtures/user.typeflow';

const out = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});
assert.deepEqual(out, {
  id: 7,
  fullName: 'Ada Lovelace',
  slugName: 'ada-lovelace',
  tagCount: 2,
});
console.log('esm import ok:', JSON.stringify(out));
