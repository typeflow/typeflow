// ts-node CJS path: ts-node transpiles this on the fly (import → require),
// and the require.extensions hook handles the .typeflow require.
import assert from 'node:assert/strict';
import mapUser from '../fixtures/user.typeflow';

const out = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});
assert.equal(out.fullName, 'Ada Lovelace');
assert.equal(out.slugName, 'ada-lovelace');
assert.equal(out.tagCount, 2);
console.log('ts-node cjs ok:', JSON.stringify(out));
