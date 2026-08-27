import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

const rules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'prefer-const': 'error',
  'no-var': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'multi-line'],
  'no-throw-literal': 'error',
};

export default defineConfig([
  globalIgnores(['dist/', 'node_modules/', '.venv/', 'assets/', 'flashcards/']),
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      ...rules,
      'no-undef': 'error',
    },
  },
  {
    files: ['*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      ...rules,
      'no-undef': 'error',
      'no-console': 'off',
    },
  },
]);
