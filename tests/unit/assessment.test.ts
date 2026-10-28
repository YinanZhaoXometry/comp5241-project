import { describe, expect, it } from 'vitest';
import {
  attemptSnapshotSchema,
  submitAttemptSchema,
  type AttemptSnapshot,
} from '../../src/contracts/assessment';
import { buildSnapshot, TEST_ITEM_POINTS, TEST_TOTAL_POINTS } from '../../src/modules/assessment-progress/bank';
import { deriveRoadmapNode, displayPercentOf, scoreAttempt, verdictLine } from '../../src/modules/assessment-progress/scoring';

// Unit coverage of the epic-3 story-1 tracer's pure surface: the AD-8
// arithmetic (unrounded cross-product pass decision, honest boundary display,
// zero-total/negative rejection), the manually authored synthetic bank (D7
// fixture validity independent of any generator) and the DERIVED roadmap node.

const objectives = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ index, text: `Synthetic objective ${index + 1}` }));

describe('scoring: unrounded cross-product and honest display', () => {
  it('decides the plan golden boundary cases exactly', () => {
    // 7996x100 = 799600 < 80x10000 = 800000 -> Not passed; two decimals.
    const boundary = scoreAttempt(7996, 10000);
    expect(boundary.passed).toBe(false);
    expect(boundary.displayPercent).toBe('79.96%');
    expect(verdictLine(boundary)).toBe('79.96% — Not passed (mark is 80%)');
    // Exact boundary passes.
    const exact = scoreAttempt(8000, 10000);
    expect(exact.passed).toBe(true);
    expect(exact.displayPercent).toBe('80.0%');
    expect(verdictLine(exact)).toBe('80.0% — Pass (mark is 80%)');
    // Above boundary passes.
    const above = scoreAttempt(8004, 10000);
    expect(above.passed).toBe(true);
    expect(above.displayPercent).toBe('80.0%');
  });
  it('shows one decimal only when it cannot contradict the verdict', () => {
    expect(displayPercentOf(0, 10000, 80, false)).toBe('0.0%');
    expect(displayPercentOf(10000, 10000, 80, true)).toBe('100.0%');
    // 79.9 one-decimal stays below the mark — not misleading.
    expect(displayPercentOf(7990, 10000, 80, false)).toBe('79.9%');
    // 79.95 rounds to a misleading 80.0 — two decimals shown.
    expect(displayPercentOf(7995, 10000, 80, false)).toBe('79.95%');
    // A pass never displays below its mark.
    expect(displayPercentOf(8005, 10000, 80, true)).toBe('80.1%');
    // Non-round totals stay honest too.
    expect(displayPercentOf(2, 3, 80, false)).toBe('66.7%');
    expect(scoreAttempt(2, 3).passed).toBe(false);
    expect(scoreAttempt(3, 3).passed).toBe(true);
  });
  it('rejects invalid rubrics: zero total, negative, over-earn, non-integer, unsafe marks', () => {
    expect(() => scoreAttempt(0, 0)).toThrow();
    expect(() => scoreAttempt(-1, 10000)).toThrow();
    expect(() => scoreAttempt(10001, 10000)).toThrow();
    expect(() => scoreAttempt(1.5, 10000)).toThrow();
    expect(() => scoreAttempt(1, 10.5)).toThrow();
    expect(() => scoreAttempt(1, 100, 0)).toThrow();
    expect(() => scoreAttempt(1, 100, 101)).toThrow();
    expect(() => scoreAttempt(1, 100, 80.5)).toThrow();
  });
});

describe('manual synthetic test bank (D7 fixture)', () => {
  it('is five items whose points sum to exactly 10000 with a reachable boundary', () => {
    expect(TEST_ITEM_POINTS).toEqual([1999, 1999, 1999, 1999, 2004]);
    expect(TEST_TOTAL_POINTS).toBe(10000);
    // Correct on the first four, wrong on the 2004-point fifth item: the
    // honest 79.96% boundary the story's matrix names.
    const boundaryEarned = TEST_ITEM_POINTS.slice(0, 4).reduce((sum, points) => sum + points, 0);
    expect(boundaryEarned).toBe(7996);
    expect(scoreAttempt(boundaryEarned, TEST_TOTAL_POINTS).displayPercent).toBe('79.96%');
  });
  it('builds a schema-valid snapshot with resolvable answers and substituted prompts', () => {
    const snapshot = buildSnapshot(objectives(3));
    expect(attemptSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.testId).toBe('required-test-1');
    expect(snapshot.source).toBe('manual-synthetic');
    expect(snapshot.passMarkPercent).toBe(80);
    expect(snapshot.items).toHaveLength(5);
    for (const [position, item] of snapshot.items.entries()) {
      expect(item.position).toBe(position + 1);
      expect(item.points).toBe(TEST_ITEM_POINTS[position]);
      expect(item.choices.some(choice => choice.id === item.answerId)).toBe(true);
      expect(new Set(item.choices.map(choice => choice.id)).size).toBe(item.choices.length);
      expect(item.prompt).not.toContain('{objective}');
      expect(item.prompt).toContain(item.objective);
    }
    expect(snapshot.items.reduce((sum, item) => sum + item.points, 0)).toBe(snapshot.totalPoints);
  });
  it('links items positionally (round-robin) so every objective count resolves', () => {
    const two = buildSnapshot(objectives(2));
    expect(two.items.map(item => item.objectiveIndex)).toEqual([0, 1, 0, 1, 0]);
    const eight = buildSnapshot(objectives(8));
    expect(eight.items.map(item => item.objectiveIndex)).toEqual([0, 1, 2, 3, 4]);
    // Deterministic: the same objectives build the byte-identical snapshot.
    expect(buildSnapshot(objectives(2))).toEqual(two);
    expect(() => buildSnapshot([])).toThrow();
  });
  it('keeps the submit command strict: no forged fields, bounded answers', () => {
    const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
    const attemptId = crypto.randomUUID();
    expect(submitAttemptSchema.safeParse({ ...command, attemptId, answers: [{ position: 1, choiceId: 'b' }] }).success).toBe(true);
    expect(submitAttemptSchema.safeParse({ ...command, attemptId, answers: [] }).success).toBe(true);
    expect(submitAttemptSchema.safeParse({ ...command, attemptId, answers: [{ position: 1, choiceId: 'b', score: 1 }] }).success).toBe(false);
    expect(submitAttemptSchema.safeParse({ ...command, attemptId, answers: [{ position: 9, choiceId: 'b' }] }).success).toBe(false);
    expect(submitAttemptSchema.safeParse({ ...command, answers: [] }).success).toBe(false);
  });
  it('rejects tampered snapshots: mismatched totals, missing answers, duplicate choice ids', () => {
    const snapshot: AttemptSnapshot = buildSnapshot(objectives(2));
    expect(attemptSnapshotSchema.safeParse({ ...snapshot, totalPoints: 9999 }).success).toBe(false);
    expect(attemptSnapshotSchema.safeParse({ ...snapshot, items: [] }).success).toBe(false);
    const tampered = structuredClone(snapshot);
    tampered.items[0].answerId = 'zz';
    expect(attemptSnapshotSchema.safeParse(tampered).success).toBe(false);
    const duplicated = structuredClone(snapshot);
    duplicated.items[0].choices = [...duplicated.items[0].choices, duplicated.items[0].choices[0]];
    expect(attemptSnapshotSchema.safeParse(duplicated).success).toBe(false);
  });
});

describe('derived roadmap node', () => {
  it('completes only on all required items done plus a passed attempt on the current version', () => {
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 2 }, passedAttemptOnCurrentVersion: true, anyAttempt: true })).toBe('completed');
    // A pass on an OLDER version does not complete the current one.
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 2 }, passedAttemptOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    // Required items missing blocks completion even with a pass.
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 1 }, passedAttemptOnCurrentVersion: true, anyAttempt: true })).toBe('in-progress');
  });
  it('marks engagement in progress and nothing as not started', () => {
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 0 }, passedAttemptOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 1 }, passedAttemptOnCurrentVersion: false, anyAttempt: false })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 0 }, passedAttemptOnCurrentVersion: false, anyAttempt: false })).toBe('not-started');
    // No course view yet (regeneration in flight): attempts keep it in progress.
    expect(deriveRoadmapNode({ requiredItems: { total: 0, done: 0 }, passedAttemptOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 0, done: 0 }, passedAttemptOnCurrentVersion: false, anyAttempt: false })).toBe('not-started');
  });
});
