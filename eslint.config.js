// ESLint 9 (flat config). Фронтенд public/index.html — один большой legacy-файл,
// он не линтится до этапа 1 (разборка на модули), поэтому исключён.
const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['node_modules/**', 'public/**', 'data.db*'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly', process: 'readonly', fetch: 'readonly',
        require: 'readonly', module: 'readonly', exports: 'readonly',
        __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        console: 'readonly', process: 'readonly', fetch: 'readonly',
      },
    },
  },
];
