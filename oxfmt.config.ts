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
    'src/rust/**',
    'examples/**',
    'docs/.vitepress/cache/**',
    'docs/.vitepress/dist/**',
    'graphify-out/**',
  ],
});
