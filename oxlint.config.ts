import base from '@typeflowjs/lint-config/oxlint';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [base],
  ignorePatterns: ['**/node_modules/**', 'dist/**'],
});
