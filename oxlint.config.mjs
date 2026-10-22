import { nativeRules } from './scripts/lint-policy.mjs';

const config = {
  plugins: ['react', 'nextjs', 'import', 'jsx-a11y'],
  categories: { correctness: 'error' },
  rules: nativeRules,
  settings: { next: { rootDir: '.' } },
  ignorePatterns: [
    'node_modules/**',
    '.local/**',
    '.next/**',
    '_bmad/**',
    'next-env.d.ts',
    'test-results/**',
    'playwright-report/**',
  ],
};
export default config;
