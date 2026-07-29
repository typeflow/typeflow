import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 80,
  sortPackageJson: true,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  bracketSpacing: true,
  endOfLine: 'lf',
  bracketSameLine: true,
  insertFinalNewline: true,
  ignorePatterns: [
    '**/node_modules/**',
    'dist/**',
    'examples/**',
    'graphify-out/**',
  ],
});
