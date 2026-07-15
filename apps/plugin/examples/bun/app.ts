import mapUser from './user.typeflow';

const view = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});
console.log(view);
