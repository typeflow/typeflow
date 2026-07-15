// Vite path: bundled by `vite build` with @typeflow/plugin/vite — the
// compiled artifact and the `use` helpers get bundled in; the output runs
// standalone (no hooks needed at runtime).
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
console.log('vite build ok:', JSON.stringify(out));
