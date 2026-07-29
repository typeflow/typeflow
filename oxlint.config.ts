import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise', 'node'],
  env: {
    node: true,
    commonjs: true,
    builtin: true,
    browser: true,
  },
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'warn',
  },
  rules: {
    eqeqeq: 'error',
    // Imports: no .ts/.js extensions (css/vue/json keep theirs), imports first,
    // no duplicate declarations, inline `type` specifiers, alphabetical order
    // (blank-line-separated groups are sorted independently).
    'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
    'import/extensions': [
      'error',
      'never',
      { css: 'always', vue: 'always', json: 'always', typeflow: 'always' },
    ],
    'import/first': 'error',
    'import/no-duplicates': 'error',
    'import/no-unassigned-import': 'off',
    'no-await-in-loop': 'off',
    'no-console': 'off',
    'no-underscore-dangle': 'off',
    'no-unused-vars': 'error',
    'no-var': 'error',
    'promise/always-return': 'off',
    'sort-imports': ['error', { ignoreCase: true, allowSeparatedGroups: true }],
    'unicorn/no-process-exit': 'off',
  },
  ignorePatterns: ['**/node_modules/**', 'dist/**'],
});
