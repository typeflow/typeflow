// Fully typed: the import resolves the user.d.typeflow.ts sidecar
// (`typeflow types` + allowArbitraryExtensions), so `view.fullName` etc. are
// statically checked by tsc.
import mapUser from './user.typeflow';

const view = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});
console.log(view.fullName, '→', view.slugName, `(${view.tagCount} tags)`);
