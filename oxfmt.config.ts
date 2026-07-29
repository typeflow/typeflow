import base from '@typeflowjs/lint-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
  ...base,
  ignorePatterns: [
    '**/node_modules/**',
    'dist/**',
    'examples/**',
    'graphify-out/**',
  ],
});
