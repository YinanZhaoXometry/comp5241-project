import { describe, expect, it } from 'vitest';
import {
  bundleCatalogSchema,
  bundleItemSchema,
  submitItemSchema,
} from '../../src/contracts/diagnostic';
import {
  checkSupportsBundle,
  materializeBundle,
  syntheticCatalog,
} from '../../src/modules/setup-diagnostic/bundle';
import type { Plan } from '../../src/contracts/setup';

// The bundle is a MANUALLY AUTHORED synthetic fixture, validated here
// independently of any generator; S6 is blocked and the take-path acceptance
// on an eligible generator stays open.
describe('manual synthetic check bundle', () => {
  it('is a bounded 3–5-item set with resolvable declared answers', () => {
    const parsed = bundleCatalogSchema.parse(syntheticCatalog);
    expect(parsed.source).toBe('manual-synthetic');
    expect(parsed.items.length).toBeGreaterThanOrEqual(3);
    expect(parsed.items.length).toBeLessThanOrEqual(5);
    for (const item of parsed.items) {
      expect(item.choices.some(choice => choice.id === item.answerId)).toBe(true);
      expect(item.rationale.length).toBeGreaterThan(0);
      expect(new Set(item.choices.map(choice => choice.id)).size).toBe(item.choices.length);
    }
  });
  it('links every item to distinct objective and source slots it declares', () => {
    for (const item of syntheticCatalog.items) {
      expect(item.prompt).toContain('{objective}');
      expect(item.prompt).toContain('{source}');
    }
    expect(syntheticCatalog.items.map(item => [item.objectiveIndex, item.sourcePosition])).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
      [2, 0],
    ]);
  });
  it('rejects tampered items: answer outside choices, duplicate ids, wrong size', () => {
    const base = syntheticCatalog.items[0];
    expect(bundleItemSchema.safeParse({ ...base, answerId: 'zz' }).success).toBe(false);
    expect(
      bundleItemSchema.safeParse({ ...base, choices: [...base.choices, base.choices[0]] }).success,
    ).toBe(false);
    expect(bundleCatalogSchema.safeParse({ source: 'manual-synthetic', items: [] }).success).toBe(false);
    expect(bundleCatalogSchema.safeParse({ source: 'generator', items: syntheticCatalog.items }).success).toBe(false);
  });
  it('materializes against the confirmed plan and refuses unsupported plans', () => {
    const plan = (outcomes: number): Plan => ({
      topic: 'Synthetic check',
      goal: 'Apply a skill',
      clarification: '',
      outcomes: Array.from({ length: outcomes }, (_, index) => `Synthetic outcome ${index + 1}`),
      miniCourse: { title: 'Check', lessons: ['One lesson'], practice: 'Practice', estimatedMinutes: 20 },
      missingExplanations: 'Coverage not assessed.',
    });
    const sources = [{ filename: 'diag-0.txt' }, { filename: 'diag-1.txt' }];
    expect(checkSupportsBundle(plan(3), sources)).toBe(true);
    expect(checkSupportsBundle(plan(2), sources)).toBe(false);
    expect(checkSupportsBundle(plan(3), [sources[0]])).toBe(false);
    const materialized = materializeBundle(plan(3), sources);
    expect(materialized).toHaveLength(4);
    expect(materialized[0].objective).toBe('Synthetic outcome 1');
    expect(materialized[0].sourceRef).toBe('diag-0.txt');
    expect(materialized[0].prompt).toContain('Synthetic outcome 1');
    expect(materialized[0].prompt).toContain('diag-0.txt');
    expect(materialized[0].prompt).not.toContain('{objective}');
    expect(() => materializeBundle(plan(1), [sources[0]])).toThrow();
  });
  it('keeps submission commands strict: no forged fields, skip has no choice', () => {
    const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
    expect(submitItemSchema.safeParse({ ...command, position: 1, choiceId: 'b', assistance: 'unaided' }).success).toBe(true);
    expect(submitItemSchema.safeParse({ ...command, position: 1, assistance: 'assisted' }).success).toBe(true);
    expect(submitItemSchema.safeParse({ ...command, position: 1, choiceId: 'b', assistance: 'unaided', score: 1 }).success).toBe(false);
    expect(submitItemSchema.safeParse({ ...command, position: 9, choiceId: 'b', assistance: 'unaided' }).success).toBe(false);
  });
});
