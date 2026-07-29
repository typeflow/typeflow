/**
 * Side-effect registration for `node --import @typeflowjs/plugin/register`:
 * installs the ESM loader hooks AND the CommonJS require hook, so both
 * `import x from './m.typeflow'` and `require('./m.typeflow')` work in the
 * same process.
 */
import { installEsmHook } from './esm';
import { installRequireHook } from './cjs';

installEsmHook();
installRequireHook();
