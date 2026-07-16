import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const activeFiles = [
  'index.tsx',
  'App.tsx',
  'constants.ts',
  'types.ts',
  'features/**/*.{ts,tsx}',
  'pages/**/*.{ts,tsx}',
  'shared/**/*.{ts,tsx}',
  'lib/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'migrated_prompt_history/',
      'src/',
      'components/',
      'context/',
      'services/',
      '*.js',
      '*.cjs',
      '!eslint.config.js',
    ],
  },
  {
    files: activeFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['vite.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
);
