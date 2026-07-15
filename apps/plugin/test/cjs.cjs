// Exercises `require('*.typeflow')` (Node with --import
// @typeflow/plugin/register, which installs the require hook too).
const assert = require('node:assert/strict');
const mapUser = require('./fixtures/user.typeflow');

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
// TS-compiled default imports under CJS land on .default — same function.
assert.equal(mapUser.default, mapUser);
console.log('cjs require ok:', JSON.stringify(out));
