// "Normal TypeScript" path: compiled by tsc with a real tsconfig
// (allowArbitraryExtensions + the .d.typeflow.ts sidecar make the import
// fully typed), then the EMITTED JavaScript runs under
// `node --import @typeflowjs/plugin/register`.
import assert from 'node:assert/strict';
import mapUser from '../fixtures/user.typeflow';

const out = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});
// `out` is typed from the sidecar — these property accesses are checked by tsc.
assert.equal(out.fullName, 'Ada Lovelace');
assert.equal(out.slugName, 'ada-lovelace');
assert.equal(out.tagCount, 2);
console.log('tsc esm ok:', JSON.stringify(out));
