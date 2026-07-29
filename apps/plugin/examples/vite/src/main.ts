// The mapping runs CLIENT-SIDE: compilation happened at build/dev time in
// the Vite plugin, and this module only bundles typeflowjs/runtime (the
// tiny browser-safe interpreter) plus the compiled artifact.
import mapUser from './user.typeflow';

const view = mapUser({
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  tags: ['founder', 'math'],
});

document.querySelector('#app')!.textContent = JSON.stringify(view, null, 2);
console.log(view);
