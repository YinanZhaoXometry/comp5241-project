import { describe, expect, it } from 'vitest';
import {
  attemptSnapshotSchema,
  retestSnapshotSchema,
  startRetestSchema,
  submitAttemptSchema,
  submitRetestSchema,
  type AttemptSnapshot,
  type RetestSnapshot,
} from '../../src/contracts/assessment';
import { buildSnapshot, buildRetestSnapshot, TEST_ITEM_POINTS, TEST_TOTAL_POINTS } from '../../src/modules/assessment-progress/bank';
import { deriveRoadmapNode, displayPercentOf, groupCleared, groupResultsOf, recoverySatisfied, scoreAttempt, verdictLine } from '../../src/modules/assessment-progress/scoring';

// Unit coverage of the epic-3 story-1 tracer's pure surface plus the story-2
// targeted-recovery arithmetic: the AD-8 scoring (unrounded cross-product pass
// decision, honest boundary display, zero-total/negative rejection), the
// manually authored synthetic banks (D7 fixture validity independent of any
// generator — root AND fresh retest pool), the per-objective-group ledger
// arithmetic (initial results, independent clearing, requirement
// satisfaction) and the DERIVED roadmap node including recovery credit.

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
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 2 }, passedAttemptOnCurrentVersion: true, recoveredOnCurrentVersion: false, anyAttempt: true })).toBe('completed');
    // A pass on an OLDER version does not complete the current one.
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 2 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    // Required items missing blocks completion even with a pass.
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 1 }, passedAttemptOnCurrentVersion: true, recoveredOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
  });
  it('accepts a fully-recovered failed attempt as completion, never a partial recovery', () => {
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 2 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: true, anyAttempt: true })).toBe('completed');
    // A chain pinned to a superseded version (recovered=false here) never
    // completes the current node even with required items done.
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 2 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 1 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: true, anyAttempt: true })).toBe('in-progress');
  });
  it('marks engagement in progress and nothing as not started', () => {
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 0 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 1 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: false })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 2, done: 0 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: false })).toBe('not-started');
    // No course view yet (regeneration in flight): attempts keep it in progress.
    expect(deriveRoadmapNode({ requiredItems: { total: 0, done: 0 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ requiredItems: { total: 0, done: 0 }, passedAttemptOnCurrentVersion: false, recoveredOnCurrentVersion: false, anyAttempt: false })).toBe('not-started');
  });
});

// ---------------------------------------------------------------------------
// Story 2 — targeted recovery: group arithmetic, the fresh retest bank, the
// retest snapshot builder and the recovery command surface.
// ---------------------------------------------------------------------------

describe('story 2: per-objective-group arithmetic (AD-8 targeted credit)', () => {
  // The plan's fixture: a 3-objective root, wrong on items 3 (obj2) and
  // 5 (obj1) — 5997/10000 overall with exactly obj1+obj2 failed, obj0 passed.
  const root = buildSnapshot(objectives(3));
  const answerMap = (wrong: number[]) =>
    root.items.map(item => ({ position: item.position, choiceId: wrong.includes(item.position) ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId }));
  const groups = groupResultsOf(root, answerMap([3, 5]));

  it('computes initial group results under the attempt snapshot exactly (5997 fixture)', () => {
    expect(root.items.map(item => item.objectiveIndex)).toEqual([0, 1, 2, 0, 1]);
    expect(groups).toEqual([
      { objectiveIndex: 0, objective: 'Synthetic objective 1', earned: 3998, total: 3998 },
      { objectiveIndex: 1, objective: 'Synthetic objective 2', earned: 1999, total: 4003 },
      { objectiveIndex: 2, objective: 'Synthetic objective 3', earned: 0, total: 1999 },
    ]);
    // The overall score is the honest 5997/10000 (59.97%); the one-decimal
    // display "60.0%" does not contradict the Not-passed verdict, so it is
    // the honest display (the spine's display rule).
    const earned = groups.reduce((sum, group) => sum + group.earned, 0);
    expect(earned).toBe(5997);
    const overall = scoreAttempt(earned, TEST_TOTAL_POINTS);
    expect(overall.displayPercent).toBe('60.0%');
    expect(verdictLine(overall)).toBe('60.0% — Not passed (mark is 80%)');
  });
  it('clears a group only at the root mark by the same integer cross-product', () => {
    expect(groupCleared(groups[0], 80)).toBe(true); // 3998/3998 passes
    expect(groupCleared(groups[1], 80)).toBe(false); // 1999/4003 = 49.91% stays open
    expect(groupCleared(groups[2], 80)).toBe(false); // 0/1999 stays open
    // Boundary honesty at group level: exactly at the mark clears.
    expect(groupCleared({ earned: 4003, total: 4003 }, 80)).toBe(true);
    expect(groupCleared({ earned: 3202, total: 4003 }, 80)).toBe(false); // 79.99% — one point short
    expect(groupCleared({ earned: 3203, total: 4003 }, 80)).toBe(true); // 80.04%
    expect(() => groupCleared({ earned: 0, total: 0 }, 80)).toThrow();
    expect(() => groupCleared({ earned: -1, total: 10 }, 80)).toThrow();
    expect(() => groupCleared({ earned: 11, total: 10 }, 80)).toThrow();
  });
  it('satisfies the failed-test requirement only when every ledgered target clears', () => {
    expect(recoverySatisfied([])).toBe(false); // an absent ledger never satisfies
    expect(recoverySatisfied([{ status: 'open' }])).toBe(false);
    expect(recoverySatisfied([{ status: 'cleared' }, { status: 'open' }])).toBe(false);
    expect(recoverySatisfied([{ status: 'cleared' }, { status: 'cleared' }])).toBe(true);
  });
});

describe('story 2: fresh retest bank and buildRetestSnapshot (D7 comparability)', () => {
  const root = buildSnapshot(objectives(3));
  const wrong = (snapshot: AttemptSnapshot | RetestSnapshot, wrongPositions: number[]) =>
    snapshot.items.map(item => ({ position: item.position, choiceId: wrongPositions.includes(item.position) ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId }));

  it('mirrors each target group per-item points one-for-one with fresh questions', () => {
    const retest = buildRetestSnapshot(root, [1, 2]);
    expect(retestSnapshotSchema.parse(retest)).toEqual(retest);
    expect(retest.testId).toBe('targeted-retest-1');
    expect(retest.items.map(item => item.position)).toEqual([1, 2, 3]); // renumbered 1..n
    // obj1 = root items 2 (1999) + 5 (2004); obj2 = root item 3 (1999) —
    // mirrored exactly, same objective slots, same points, same order.
    expect(retest.items.map(item => [item.objectiveIndex, item.points])).toEqual([[1, 1999], [2, 1999], [1, 2004]]);
    expect(retest.items.map(item => item.objectiveIndex)).toEqual(root.items.filter(item => [1, 2].includes(item.objectiveIndex)).map(item => item.objectiveIndex));
    expect(retest.items.map(item => item.points)).toEqual(root.items.filter(item => [1, 2].includes(item.objectiveIndex)).map(item => item.points));
    expect(retest.totalPoints).toBe(1999 + 1999 + 2004);
    // Root policy rides unchanged: same pass mark, answer rule, rubric.
    expect(retest.passMarkPercent).toBe(root.passMarkPercent);
    expect(retest.answerRule).toBe(root.answerRule);
    expect(retest.rubric).toBe(root.rubric);
    // FRESH questions: no retest prompt equals its root counterpart's prompt,
    // and each correct answer resolves against its own choices.
    for (const item of retest.items) {
      expect(item.prompt).not.toBe(root.items[item.position - 1].prompt);
      expect(item.choices.some(choice => choice.id === item.answerId)).toBe(true);
      expect(item.prompt).not.toContain('{objective}');
    }
    // Deterministic: the same declaration builds the byte-identical snapshot.
    expect(buildRetestSnapshot(root, [1, 2])).toEqual(retest);
  });
  it('clears the mirrored groups independently at the root mark (subset chain)', () => {
    const first = buildRetestSnapshot(root, [1, 2]);
    // Correct on both obj1 items, wrong on the obj2 item: obj1 clears (4003),
    // obj2 stays open — the plan's partial-clear row.
    const firstGroups = groupResultsOf(first, wrong(first, [2]));
    expect(firstGroups).toEqual([
      { objectiveIndex: 1, objective: 'Synthetic objective 2', earned: 4003, total: 4003 },
      { objectiveIndex: 2, objective: 'Synthetic objective 3', earned: 0, total: 1999 },
    ]);
    expect(firstGroups.map(group => groupCleared(group, first.passMarkPercent))).toEqual([true, false]);
    // Later retest targets only the remaining group and clears it.
    const second = buildRetestSnapshot(root, [2]);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].points).toBe(1999);
    const secondGroups = groupResultsOf(second, second.items.map(item => ({ position: item.position, choiceId: item.answerId })));
    expect(secondGroups[0]).toMatchObject({ objectiveIndex: 2, earned: 1999, total: 1999 });
    expect(groupCleared(secondGroups[0], second.passMarkPercent)).toBe(true);
  });
  it('rejects malformed declarations: duplicates, foreign indexes, empty sets', () => {
    expect(() => buildRetestSnapshot(root, [])).toThrow();
    expect(() => buildRetestSnapshot(root, [1, 1])).toThrow();
    // objective index 5 exists in no 3-objective root blueprint — foreign.
    expect(() => buildRetestSnapshot(root, [5])).toThrow();
    // A PASSED group (obj0) is not an open target: the builder only mirrors
    // declared groups, and the service layer rejects the declaration before
    // building; the pure surface rejects indexes the root carries no items for.
    expect(() => buildRetestSnapshot(root, [0, 5])).toThrow();
  });
  it('keeps the retest commands strict: non-empty targets, bounded answers, no forged fields', () => {
    const base = { schemaVersion: 1 as const, commandKey: crypto.randomUUID(), expectedRevision: 0 };
    expect(startRetestSchema.safeParse({ ...base, attemptId: crypto.randomUUID(), targetIndexes: [1] }).success).toBe(true);
    expect(startRetestSchema.safeParse({ ...base, attemptId: crypto.randomUUID(), targetIndexes: [] }).success).toBe(false);
    expect(startRetestSchema.safeParse({ ...base, attemptId: crypto.randomUUID(), targetIndexes: [1, 9] }).success).toBe(false);
    expect(startRetestSchema.safeParse({ ...base, attemptId: 'not-a-uuid', targetIndexes: [1] }).success).toBe(false);
    expect(startRetestSchema.safeParse({ ...base, attemptId: crypto.randomUUID(), targetIndexes: [1], fresh: true }).success).toBe(false);
    const retestId = crypto.randomUUID();
    expect(submitRetestSchema.safeParse({ ...base, retestId, answers: [{ position: 1, choiceId: 'b' }] }).success).toBe(true);
    expect(submitRetestSchema.safeParse({ ...base, retestId, answers: [{ position: 1, choiceId: 'b', score: 1 }] }).success).toBe(false);
    expect(submitRetestSchema.safeParse({ ...base, answers: [] }).success).toBe(false);
  });
  it('rejects tampered retest snapshots like ordinary ones', () => {
    const retest = buildRetestSnapshot(root, [1, 2]);
    expect(retestSnapshotSchema.safeParse({ ...retest, totalPoints: 1 }).success).toBe(false);
    const tampered = structuredClone(retest);
    tampered.items[0].position = 9;
    expect(retestSnapshotSchema.safeParse(tampered).success).toBe(false);
    // An ordinary testId never passes as a retest snapshot and vice versa.
    expect(retestSnapshotSchema.safeParse(buildSnapshot(objectives(2)) as unknown).success).toBe(false);
    expect(attemptSnapshotSchema.safeParse(retest as unknown).success).toBe(false);
  });
});
