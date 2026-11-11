// Lint for the app and its tests (npm run lint). The vendored library is someone else's code, as shipped.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['web/vendor/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['web/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.browser },
    rules: {
      // A catch that leaves it at that is how the app says "this may fail, and that's fine" (storage, clipboard).
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['tests/web/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },
];
