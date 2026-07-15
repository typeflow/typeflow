// ts-node transpiles this to CommonJS on the fly (import → require); the
// plugin's require hook then handles the .typeflow require.
import mapUser from './user.typeflow';

const view = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});
console.log(view);
