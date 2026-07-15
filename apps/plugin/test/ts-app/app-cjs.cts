// Same as app-esm.ts but compiled to CommonJS (.cts → .cjs): tsc emits a
// require() + default-import interop, exercising the require.extensions hook
// through TypeScript-compiled code.
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
console.log('tsc cjs ok:', JSON.stringify(out));
