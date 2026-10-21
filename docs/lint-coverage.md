# Lint replacement evidence — 2026-10-21

## Decision and scope

The user authorized replacing the vulnerable preset while preserving checks.
Next16.4.2, React19.3.1 and TypeScript6.0.3 remain unchanged. ESLint10.13.0,
typescript-eslint8.72.0, eslint-plugin-react-hooks7.1.1 and Oxlint1.89.0 are
exact-pinned and normally resolved without peer overrides. The Next preset and
its vulnerable braces chain are no longer in the lockfile. Native full audit
reports zero vulnerabilities; clean install blocks lifecycle scripts. This is
evidence about this lockfile, not proof of absence of all vulnerabilities.

## Coverage contract

- [scripts/lint-baseline.mjs](../scripts/lint-baseline.mjs) records 113 effective
  entries captured from the former Next16.4.2 core-web-vitals plus TypeScript
  configuration, including disabled entries and alt-text options.
- [scripts/lint-policy.mjs](../scripts/lint-policy.mjs) maps active core/TS/hooks
  checks to supported ESLint plugins and Next/React/import/JSX accessibility to
  native Oxlint rules. Warnings remain warnings but both lint engines fail on
  warnings. No active baseline severity is lowered.
- JSX reference bookkeeping (`jsx-uses-react` / `jsx-uses-vars`) is handled by
  TypeScript parser scope analysis rather than unnecessary React runtime imports;
  the positive JSX reference fixture prevents false unused-component failures.
- Two missing native ports use stricter executable restrictions: no React classes
  or deprecated React/ReactDOM API imports/properties, and no location-property
  navigation (use Next navigation). This deliberately restricts future code, not
  merely today's application. The restrictions are errors.
- [scripts/check-lint-coverage.mjs](../scripts/check-lint-coverage.mjs) checks every
  active mapping exists and its effective printed severity/options, verifies all
  stronger ESLint restrictions remain configured, then actually runs eight
  negative probes: Next synchronous script, JSX key, image alt text, anonymous
  export, conditional hook, explicit Any, class declaration and location navigation.
  These are semantic smoke probes, not a claim that independent linter engines
  have byte-identical behavior for every possible program.
- Separate TypeScript, unit, real PostgreSQL, browser and build commands remain
  required. No audit exclusions, forced downgrade, peer override, suppressed
  rule, skipped test or broad vulnerability exception was introduced.

## Official references

The former published Next16.4.2 package's index, TypeScript and core-web-vitals
source files were independently fetched and read from the registry archive after
replacement, without installing or executing its vulnerable dependency chain.
They confirm the inherited recommended sets, explicit overrides and alt-text
options represented by the preserved inventory.

- [Oxlint built-in plugins](https://oxc.rs/docs/guide/usage/linter/plugins.html)
- [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html)
- [ESLint supported versions](https://eslint.org/version-support/)
- [typescript-eslint dependency compatibility](https://typescript-eslint.io/users/dependency-versions/)
- [Next lint guidance](https://nextjs.org/docs/app/api-reference/config/eslint)

The old audit failure and accepted pending Node runtime risk remain in the
[preflight history](../_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/runtime-preflight.md).