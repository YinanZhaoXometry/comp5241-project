import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { baseline, severity } from './lint-baseline.mjs';
import {
  eslintRules,
  parserHandled,
  stronger,
  restrictions,
} from './lint-policy.mjs';

const available = new Set(
  JSON.parse(
    execFileSync(
      process.execPath,
      ['node_modules/oxlint/bin/oxlint', '--rules', '--format=json'],
      { encoding: 'utf8' },
    ),
  ).map(
    (rule) => `${rule.scope.replace('jsx_a11y', 'jsx-a11y')}/${rule.value}`,
  ),
);
const eslint = new ESLint();
const effective = await eslint.calculateConfigForFile('src/probe.tsx');
const native = JSON.parse(
  execFileSync(
    process.execPath,
    [
      'node_modules/oxlint/bin/oxlint',
      '--config',
      'oxlint.config.mjs',
      '--print-config',
    ],
    { encoding: 'utf8' },
  ),
);
const nativeSeverity = (value) =>
  severity(Array.isArray(value) ? value[0] : value) ??
  { deny: 2, warn: 1, allow: 0 }[Array.isArray(value) ? value[0] : value];
for (const [rule, value] of Object.entries(restrictions)) {
  assert.equal(
    severity(effective.rules[rule]),
    2,
    `Missing stronger restriction: ${rule}`,
  );
  assert.deepEqual(
    effective.rules[rule].slice(1),
    value.slice(1),
    `Changed stronger restriction: ${rule}`,
  );
}
for (const [rule, value] of Object.entries(baseline)) {
  if (!severity(value)) continue;
  if (rule in eslintRules)
    assert.ok(severity(effective.rules[rule]) >= severity(value), rule);
  else if (!parserHandled.has(rule) && !stronger.has(rule)) {
    const target = rule.replace('@next/next/', 'nextjs/');
    const configured = native.rules[target.replace('jsx-a11y/', 'jsx_a11y/')];
    assert.ok(available.has(target), `Unknown native mapping: ${rule}`);
    assert.ok(
      nativeSeverity(configured) >= severity(value),
      `Effective native severity: ${rule}`,
    );
    if (Array.isArray(value))
      assert.deepEqual(
        configured.slice(1).flat(),
        value.slice(1),
        `Effective native options: ${rule}`,
      );
  }
}
const negatives = [
  [
    'nextjs/no-sync-scripts',
    'export default function Probe(){return <script src="/x.js"/>}',
  ],
  [
    'react/jsx-key',
    'export default function Probe(){return [1,2].map(x=><span>{x}</span>)}',
  ],
  [
    'jsx-a11y/alt-text',
    'export default function Probe(){return <img src="/x.png"/>}',
  ],
  ['import/no-anonymous-default-export', 'export default {};'],
];
for (const [rule, code] of negatives) {
  const directory = await mkdtemp(join(tmpdir(), 'tracer-lint-'));
  try {
    const path = join(directory, 'probe.tsx');
    await writeFile(path, code);
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/oxlint/bin/oxlint',
        '--config',
        'oxlint.config.mjs',
        '--format=json',
        '--max-warnings=0',
        path,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, rule);
    assert.ok(
      JSON.parse(result.stdout).diagnostics.some((diagnostic) =>
        diagnostic.url
          ?.replace('jsx_a11y', 'jsx-a11y')
          .endsWith(`/rules/${rule}.html`),
      ),
      `${rule}: ${result.stdout}${result.stderr}`,
    );
  } finally {
    await rm(directory, { recursive: true });
  }
}
for (const [rule, code] of [
  [
    'react-hooks/rules-of-hooks',
    'import {useState} from "react"; export function Probe({ok}:{ok:boolean}){if(ok) useState(0); return null;}',
  ],
  ['@typescript-eslint/no-explicit-any', 'export const probe: any = 1;'],
  ['no-restricted-syntax', 'export class Legacy {}'],
  ['no-restricted-properties', 'window.location.assign("relative");'],
]) {
  const results = await eslint.lintText(code, { filePath: 'src/probe.tsx' });
  assert.ok(
    results[0].messages.some((message) => message.ruleId === rule),
    rule,
  );
}
const valid = await eslint.lintText(
  'function Child(){return <span/>} export default function Probe(){return <Child/>}',
  { filePath: 'src/probe.tsx' },
);
assert.equal(valid[0].messages.length, 0, JSON.stringify(valid[0].messages));
console.log(
  `Lint coverage: ${Object.keys(baseline).length} inventoried rules; all active mappings verified; 8 negative probes and JSX reference positive probe passed.`,
);
