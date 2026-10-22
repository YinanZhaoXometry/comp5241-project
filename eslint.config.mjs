import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import { eslintRules, restrictions } from './scripts/lint-policy.mjs';

export default defineConfig([
  globalIgnores([
    '.next/**',
    '.local/**',
    '_bmad/**',
    'node_modules/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': hooks },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: { ...eslintRules, ...restrictions },
  },
]);
