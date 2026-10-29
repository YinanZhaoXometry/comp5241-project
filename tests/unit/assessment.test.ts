import { describe, expect, it } from 'vitest';
import {
  attemptSnapshotSchema,
  attemptStatuses,
  retestSnapshotSchema,
  partialCreditSnapshotSchema,
  parentManifestSchema,
  passMarkOverrideOf,
  pointsScaleOf,
  startRetestSchema,
  submitAttemptSchema,
  submitRetestSchema,
  switchCourseVersionSchema,
  PARTIAL_CREDIT_TEST_ID,
  DEFAULT_PASS_MARK_OVERRIDE,
  type AttemptSnapshot,
  type RetestSnapshot,
} from '../../src/contracts/assessment';
import { buildSnapshot, buildRetestSnapshot, buildPartialCreditSnapshot, TEST_ITEM_POINTS, TEST_TOTAL_POINTS, PARTIAL_ITEM_POINTS, PARTIAL_TOTAL_POINTS } from '../../src/modules/assessment-progress/bank';
import { completionEarned, deriveRoadmapNode, displayPercentOf, displayPointsOf, earnedOfItem, gradeAwardsCompletion, groupCleared, groupResultsOf, parentEarned, recoverySatisfied, scoreAttempt, verdictLine } from '../../src/modules/assessment-progress/scoring';

// Unit coverage of the epic-3 story-1 tracer's pure surface plus the story-2
// targeted-recovery arithmetic, the story-3 scoring surface and the story-4
// completion-award predicates: the AD-8 scoring (unrounded cross-product pass
// decision, honest boundary display, zero-total/negative rejection), the
// manually authored synthetic banks (D7 fixture validity independent of any
// generator — root AND fresh retest pool), the per-objective-group ledger
// arithmetic (initial results, independent clearing, requirement
// satisfaction), the award-derived roadmap node, the pure completion and
// parent predicates (AD-5/AD-8/D1) and the strict switch command surface.

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

describe('award-derived roadmap node (story 4)', () => {
  it('completes only when an earned award pins the studied release', () => {
    expect(deriveRoadmapNode({ awardOnCurrentVersion: true, requiredItems: { total: 2, done: 2 }, anyAttempt: true })).toBe('completed');
    // The award row IS the completion record; item counts no longer gate the
    // node (they gated the award at verb time).
    expect(deriveRoadmapNode({ awardOnCurrentVersion: true, requiredItems: { total: 2, done: 0 }, anyAttempt: false })).toBe('completed');
  });
  it('keeps a passed-but-unawarded release honestly In progress', () => {
    // A passed/recovered attempt with no award row yet (pre-award data, or an
    // evaluation that has not landed) never reads Completed.
    expect(deriveRoadmapNode({ awardOnCurrentVersion: false, requiredItems: { total: 2, done: 2 }, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ awardOnCurrentVersion: false, requiredItems: { total: 0, done: 0 }, anyAttempt: true })).toBe('in-progress');
  });
  it('marks engagement in progress and nothing as not started', () => {
    expect(deriveRoadmapNode({ awardOnCurrentVersion: false, requiredItems: { total: 2, done: 0 }, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ awardOnCurrentVersion: false, requiredItems: { total: 2, done: 1 }, anyAttempt: false })).toBe('in-progress');
    expect(deriveRoadmapNode({ awardOnCurrentVersion: false, requiredItems: { total: 2, done: 0 }, anyAttempt: false })).toBe('not-started');
  });
});

// ---------------------------------------------------------------------------
// Story 4 — the pure completion and parent predicates (AD-5/AD-8/D1) and the
// strict command surfaces.
// ---------------------------------------------------------------------------

describe('story 4: completionEarned (content-plus-tests, nothing else)', () => {
  it('earns only on every required item done plus a satisfied required test', () => {
    expect(completionEarned({ requiredItems: { total: 2, done: 2 }, testSatisfied: true })).toBe(true);
    // Missing item blocks even a satisfied test.
    expect(completionEarned({ requiredItems: { total: 2, done: 1 }, testSatisfied: true })).toBe(false);
    // Failed/unrecovered test blocks even with all items done.
    expect(completionEarned({ requiredItems: { total: 2, done: 2 }, testSatisfied: false })).toBe(false);
    expect(completionEarned({ requiredItems: { total: 0, done: 0 }, testSatisfied: true })).toBe(false);
  });
  it('accepts only a fence-passed or fully-recovered test as satisfaction', () => {
    // The service computes testSatisfied through gradeAwardsCompletion and
    // recoverySatisfied; a provisional-typed decision maps to a non-pass and
    // an absent/partial ledger never satisfies — the wiring below is the
    // contract the integration exercises end to end.
    const provisionalPass = gradeAwardsCompletion({ gradeKind: 'provisional', pendingSince: new Date().toISOString() });
    expect(completionEarned({ requiredItems: { total: 1, done: 1 }, testSatisfied: provisionalPass })).toBe(false);
    expect(completionEarned({ requiredItems: { total: 1, done: 1 }, testSatisfied: recoverySatisfied([]) })).toBe(false);
    expect(completionEarned({ requiredItems: { total: 1, done: 1 }, testSatisfied: recoverySatisfied([{ status: 'open' }, { status: 'cleared' }]) })).toBe(false);
    expect(completionEarned({ requiredItems: { total: 1, done: 1 }, testSatisfied: gradeAwardsCompletion({ gradeKind: 'final', passed: true }) })).toBe(true);
    expect(completionEarned({ requiredItems: { total: 1, done: 1 }, testSatisfied: recoverySatisfied([{ status: 'cleared' }, { status: 'cleared' }]) })).toBe(true);
  });
});

describe('story 4: parentEarned (required children gate, optional never block)', () => {
  const child = (courseId: string, required: boolean) => ({ courseId, required });
  it('earns exactly when every required child release is awarded', () => {
    expect(parentEarned([child('a', true), child('b', true)], ['a', 'b'])).toBe(true);
    expect(parentEarned([child('a', true), child('b', true)], ['a'])).toBe(false);
    expect(parentEarned([child('a', true), child('b', true)], [])).toBe(false);
  });
  it('never lets an unawarded optional child block', () => {
    expect(parentEarned([child('a', true), child('c', false)], ['a'])).toBe(true);
    expect(parentEarned([child('a', true), child('c', false)], ['a', 'c'])).toBe(true);
    expect(parentEarned([child('a', true), child('c', false)], ['c'])).toBe(false);
  });
  it('awards nothing for a manifest with no required child', () => {
    expect(parentEarned([child('c', false)], ['c'])).toBe(false);
    expect(parentEarned([], [])).toBe(false);
  });
  it('keeps the manifest schema strict: unique child releases, bounded, no forged fields', () => {
    const base = { schemaVersion: 1 as const };
    expect(parentManifestSchema.safeParse({ ...base, children: [{ courseId: crypto.randomUUID(), required: true }] }).success).toBe(true);
    expect(parentManifestSchema.safeParse({ ...base, children: [{ courseId: crypto.randomUUID(), required: true }, { courseId: crypto.randomUUID(), required: false }] }).success).toBe(true);
    expect(parentManifestSchema.safeParse({ ...base, children: [] }).success).toBe(false);
    const duplicated = crypto.randomUUID();
    expect(parentManifestSchema.safeParse({ ...base, children: [{ courseId: duplicated, required: true }, { courseId: duplicated, required: false }] }).success).toBe(false);
    expect(parentManifestSchema.safeParse({ ...base, children: [{ courseId: 'not-a-uuid', required: true }] }).success).toBe(false);
    expect(parentManifestSchema.safeParse({ ...base, children: [{ courseId: crypto.randomUUID(), required: true, weight: 2 }] }).success).toBe(false);
  });
});

describe('story 4: switch command surface (informed, exact acknowledgment)', () => {
  const base = { schemaVersion: 1 as const, commandKey: crypto.randomUUID(), expectedRevision: 0 };
  const courseId = crypto.randomUUID();
  const acknowledged = { addedRequiredItemIds: ['lesson:2:reading'], removedRequiredItemIds: [], requiredTestChanged: true };
  it('accepts the exact command shape and nothing beside it', () => {
    expect(switchCourseVersionSchema.safeParse({ ...base, courseId, acknowledged }).success).toBe(true);
    expect(switchCourseVersionSchema.safeParse({ ...base, courseId, acknowledged: { ...acknowledged, extra: true } }).success).toBe(false);
    expect(switchCourseVersionSchema.safeParse({ ...base, courseId: 'nope', acknowledged }).success).toBe(false);
    expect(switchCourseVersionSchema.safeParse({ ...base, acknowledged }).success).toBe(false);
    expect(switchCourseVersionSchema.safeParse({ ...base, courseId, acknowledged: { ...acknowledged, addedRequiredItemIds: ['x'] } }).success).toBe(false);
    expect(switchCourseVersionSchema.safeParse({ schemaVersion: 2, commandKey: crypto.randomUUID(), expectedRevision: 0, courseId, acknowledged }).success).toBe(false);
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

// ---------------------------------------------------------------------------
// Story 3 — the snapshotted scoring surface: disclosed finite-precision
// partial credit, the carried pass-mark override contract, the provisional
// grade fence and scale-aware display.
// ---------------------------------------------------------------------------

describe('story 3: partial-credit fixture (D7) and declared-credit earning', () => {
  it('builds a schema-valid scale-100 fixture with exactly one disclosed rubric and a full-credit item beside it', () => {
    const fixture = buildPartialCreditSnapshot(objectives(2));
    expect(partialCreditSnapshotSchema.parse(fixture)).toEqual(fixture);
    expect(fixture.testId).toBe(PARTIAL_CREDIT_TEST_ID);
    expect(fixture.pointsScale).toBe(100);
    expect(fixture.passMarkPercent).toBe(80);
    expect(fixture.passMarkOverride).toEqual({ source: 'default', value: 80 });
    expect(PARTIAL_ITEM_POINTS).toEqual([600000, 400000]);
    expect(PARTIAL_TOTAL_POINTS).toBe(1000000);
    expect(fixture.items.reduce((sum, item) => sum + item.points, 0)).toBe(fixture.totalPoints);
    // Item 1 carries NO rubric (absent = full credit only); item 2 carries the
    // disclosed rubric whose only declared credit is the exact scaled integer
    // 199900 (1999.00 of 4000.00 points), never keyed on the answer.
    expect(fixture.items[0].partialCredit).toBeUndefined();
    expect(fixture.items[1].partialCredit).toEqual({ disclosure: expect.any(String), credits: { c: 199900 } });
    expect(fixture.items[1].answerId).not.toBe('c');
    // Deterministic: the same objectives build the byte-identical fixture.
    expect(buildPartialCreditSnapshot(objectives(2))).toEqual(fixture);
    expect(() => buildPartialCreditSnapshot([])).toThrow();
  });

  it('earns the declared credit exactly: full, partial, zero and unanswered', () => {
    const fixture = buildPartialCreditSnapshot(objectives(2));
    const [fullOnly, rubric] = fixture.items;
    // Full-credit item (no rubric): whole points or zero, byte-identical to
    // the 3.1/3.2 behavior.
    expect(earnedOfItem(fullOnly, fullOnly.answerId)).toBe(600000);
    expect(earnedOfItem(fullOnly, 'a')).toBe(0);
    expect(earnedOfItem(fullOnly, null)).toBe(0);
    // Rubric item: correct = full points under the answer rule; the declared
    // partly-correct choice earns EXACTLY its declared scaled integer; any
    // other non-correct choice earns zero; unanswered earns zero.
    expect(earnedOfItem(rubric, rubric.answerId)).toBe(400000);
    expect(earnedOfItem(rubric, 'c')).toBe(199900);
    expect(earnedOfItem(rubric, 'a')).toBe(0);
    expect(earnedOfItem(rubric, 'd')).toBe(0);
    expect(earnedOfItem(rubric, null)).toBe(0);
    // The root bank items have no rubric: unchanged whole-points earning.
    const root = buildSnapshot(objectives(3));
    expect(earnedOfItem(root.items[0], root.items[0].answerId)).toBe(1999);
    expect(earnedOfItem(root.items[0], 'a')).toBe(0);
  });

  it('keeps the boundary matrix exact under the hundredths scale and any rubric', () => {
    // 79.96 / 80.00 / 80.04 at scale 100 — the same cross-product, the same
    // honest displays as the plan's golden scale-1 cases.
    const below = scoreAttempt(799600, 1000000);
    expect(below.passed).toBe(false);
    expect(below.displayPercent).toBe('79.96%');
    expect(verdictLine(below)).toBe('79.96% — Not passed (mark is 80%)');
    const exact = scoreAttempt(800000, 1000000);
    expect(exact.passed).toBe(true);
    expect(exact.displayPercent).toBe('80.0%');
    expect(scoreAttempt(800400, 1000000)).toMatchObject({ passed: true, displayPercent: '80.0%' });
    // The fixture's natural boundary: correct on item 1 + the declared
    // 1999.00 partial credit on item 2 = 799900/1000000 = 79.99% — Not
    // passed, and the one-decimal "80.0%" would contradict the verdict, so
    // two decimals are shown.
    const fixtureEarned = PARTIAL_ITEM_POINTS[0] + 199900;
    const fixtureScore = scoreAttempt(fixtureEarned, PARTIAL_TOTAL_POINTS);
    expect(fixtureScore.passed).toBe(false);
    expect(fixtureScore.displayPercent).toBe('79.99%');
    expect(verdictLine(fixtureScore)).toBe('79.99% — Not passed (mark is 80%)');
    // All-correct on the fixture is an honest 100%.
    expect(scoreAttempt(PARTIAL_TOTAL_POINTS, PARTIAL_TOTAL_POINTS).displayPercent).toBe('100.0%');
  });

  it('renders scaled point amounts for humans without ever deciding anything', () => {
    expect(displayPointsOf(1999, 1)).toBe('1999');
    expect(displayPointsOf(10000, 1)).toBe('10000');
    expect(displayPointsOf(600000, 100)).toBe('6000.00');
    expect(displayPointsOf(400000, 100)).toBe('4000.00');
    expect(displayPointsOf(199900, 100)).toBe('1999.00');
    expect(displayPointsOf(199950, 100)).toBe('1999.50');
    expect(displayPointsOf(799900, 100)).toBe('7999.00');
    expect(() => displayPointsOf(-1, 1)).toThrow();
    expect(() => displayPointsOf(1.5, 100)).toThrow();
  });

  it('rejects invalid rubrics at build: negative, over-full, answer-keyed, foreign, non-precision, zero-total', () => {
    const fixture = buildPartialCreditSnapshot(objectives(2));
    const tamper = (credits: Record<string, number>) => {
      const tampered = structuredClone(fixture);
      tampered.items[1].partialCredit = { disclosure: tampered.items[1].partialCredit!.disclosure, credits };
      return partialCreditSnapshotSchema.safeParse(tampered).success;
    };
    expect(tamper({ c: -1 })).toBe(false); // negative marking is forbidden
    expect(tamper({ c: 400001 })).toBe(false); // credit may never exceed full points
    expect(tamper({ [fixture.items[1].answerId]: 199900 })).toBe(false); // the answer earns full points under the rule
    expect(tamper({ zz: 100 })).toBe(false); // a credit must name a declared choice
    expect(tamper({ c: 1999.5 })).toBe(false); // non-precision-conforming (float) credit
    // Zero-total and unknown scale are rejected on the core.
    expect(partialCreditSnapshotSchema.safeParse({ ...structuredClone(fixture), totalPoints: 0 }).success).toBe(false);
    expect(partialCreditSnapshotSchema.safeParse({ ...structuredClone(fixture), pointsScale: 10 }).success).toBe(false);
    expect(partialCreditSnapshotSchema.safeParse({ ...structuredClone(fixture), pointsScale: 1000 }).success).toBe(false);
    // A snapshot whose items carry no rubric at all is not a partial-credit
    // fixture — the fixture schema rejects it.
    const rubricless = structuredClone(fixture);
    delete rubricless.items[1].partialCredit;
    expect(partialCreditSnapshotSchema.safeParse(rubricless).success).toBe(false);
    // Withholding: a rubric declaring a credit for EVERY non-correct choice
    // (zero credits included) would disclose the answer by elimination.
    expect(tamper({ a: 0, c: 199900, d: 0 })).toBe(false);
    // The served schemas are full-credit only: a rubric item can never
    // masquerade as the ordinary required test or one of its retests.
    const rubricOnRequired = structuredClone(buildSnapshot(objectives(2)));
    rubricOnRequired.items[0].partialCredit = { disclosure: fixture.items[1].partialCredit!.disclosure, credits: { a: 1 } };
    expect(attemptSnapshotSchema.safeParse(rubricOnRequired).success).toBe(false);
    const rubricOnRetest = structuredClone(buildRetestSnapshot(buildSnapshot(objectives(3)), [1]));
    rubricOnRetest.items[0].partialCredit = { disclosure: fixture.items[1].partialCredit!.disclosure, credits: { a: 1 } };
    expect(retestSnapshotSchema.safeParse(rubricOnRetest).success).toBe(false);
  });

  it('groups partial-credit earning per objective under the same snapshot scale', () => {
    const fixture = buildPartialCreditSnapshot(objectives(2));
    // Correct on item 1 (obj0), declared partial credit on item 2 (obj1).
    const groups = groupResultsOf(fixture, [
      { position: 1, choiceId: fixture.items[0].answerId },
      { position: 2, choiceId: 'c' },
    ]);
    expect(groups).toEqual([
      { objectiveIndex: 0, objective: 'Synthetic objective 1', earned: 600000, total: 600000 },
      { objectiveIndex: 1, objective: 'Synthetic objective 2', earned: 199900, total: 400000 },
    ]);
    expect(groupCleared(groups[0], 80)).toBe(true);
    expect(groupCleared(groups[1], 80)).toBe(false); // 49.975% — the retest target stays open
  });
});

describe('story 3: carried pass-mark override contract', () => {
  it('rides the default contract on every personal-study snapshot', () => {
    const root = buildSnapshot(objectives(2));
    expect(root.passMarkPercent).toBe(80);
    expect(root.passMarkOverride).toEqual(DEFAULT_PASS_MARK_OVERRIDE);
    expect(root.pointsScale).toBe(1);
    expect(passMarkOverrideOf(root)).toEqual({ source: 'default', value: 80 });
    expect(pointsScaleOf(root)).toBe(1);
  });

  it('carries an instructor-sourced override exactly as snapshotted policy', () => {
    const recordedAt = new Date('2026-10-28T10:00:00Z').toISOString();
    const overridden = buildSnapshot(objectives(2), { source: 'instructor', value: 90, recordedAt });
    // The applicable mark IS the carried override value; the schema pins the
    // agreement so the verdict can never disagree with the contract.
    expect(overridden.passMarkPercent).toBe(90);
    expect(overridden.passMarkOverride).toEqual({ source: 'instructor', value: 90, recordedAt });
    expect(attemptSnapshotSchema.parse(overridden)).toEqual(overridden);
    // 80.01% passes the default 80 but NOT the pinned 90 — the carried
    // contract decides, exactly.
    expect(scoreAttempt(8001, 10000, overridden.passMarkPercent).passed).toBe(false);
    expect(scoreAttempt(8001, 10000).passed).toBe(true);
  });

  it('rejects a carried contract that disagrees with the applicable mark or lacks provenance', () => {
    const root = buildSnapshot(objectives(2));
    const disagreement = { ...structuredClone(root), passMarkOverride: { source: 'default', value: 90 } };
    expect(attemptSnapshotSchema.safeParse(disagreement).success).toBe(false);
    const unknownSource = { ...structuredClone(root), passMarkOverride: { source: 'committee', value: 80 } };
    expect(attemptSnapshotSchema.safeParse(unknownSource).success).toBe(false);
    const noProvenance = { ...structuredClone(root), passMarkOverride: { source: 'instructor', value: 90 } };
    expect(attemptSnapshotSchema.safeParse(noProvenance).success).toBe(false);
    const forged = { ...structuredClone(root), passMarkOverride: { source: 'instructor', value: 90, recordedAt: '2026-10-28T10:00:00Z', by: 'someone' } };
    expect(attemptSnapshotSchema.safeParse(forged).success).toBe(false);
  });

  it('normalizes legacy pre-3.3 rows: undeclared scale is 1, undeclared contract is the default', () => {
    const legacy = { passMarkPercent: 80 } as const;
    expect(pointsScaleOf(legacy)).toBe(1);
    expect(passMarkOverrideOf(legacy)).toEqual({ source: 'default', value: 80 });
  });

  it('mirrors the root scale and override onto retest snapshots (root policy fixed through the chain)', () => {
    const recordedAt = new Date('2026-10-28T10:00:00Z').toISOString();
    const root = buildSnapshot(objectives(3), { source: 'instructor', value: 90, recordedAt });
    const retest = buildRetestSnapshot(root, [1]);
    expect(retest.pointsScale).toBe(1);
    expect(retest.passMarkOverride).toEqual({ source: 'instructor', value: 90, recordedAt });
    expect(retest.passMarkPercent).toBe(90);
  });
});

describe('story 3: the provisional-grade contract can never award completion', () => {
  it('awards completion only through a final graded pass', () => {
    expect(gradeAwardsCompletion({ gradeKind: 'final', passed: true })).toBe(true);
    expect(gradeAwardsCompletion({ gradeKind: 'final', passed: false })).toBe(false);
    // A provisional-typed decision carries NO pass decision at all; it maps
    // to a non-pass through the fence and the derivations ignore it.
    expect(gradeAwardsCompletion({ gradeKind: 'provisional', pendingSince: new Date().toISOString() })).toBe(false);
    const provisionalPass = gradeAwardsCompletion({ gradeKind: 'provisional', pendingSince: new Date().toISOString() });
    // Story 4: the provisional fence rides BOTH the pure completion
    // predicate and the award-derived node — a provisional-typed result can
    // complete nothing on either path.
    expect(completionEarned({ requiredItems: { total: 2, done: 2 }, testSatisfied: provisionalPass })).toBe(false);
    expect(deriveRoadmapNode({ awardOnCurrentVersion: completionEarned({ requiredItems: { total: 2, done: 2 }, testSatisfied: provisionalPass }), requiredItems: { total: 2, done: 2 }, anyAttempt: true })).toBe('in-progress');
    expect(deriveRoadmapNode({ awardOnCurrentVersion: completionEarned({ requiredItems: { total: 2, done: 2 }, testSatisfied: gradeAwardsCompletion({ gradeKind: 'final', passed: true }) }), requiredItems: { total: 2, done: 2 }, anyAttempt: true })).toBe('completed');
  });

  it('keeps the provisional kind out of every stored status (contract-only, epic 5 confirms it)', () => {
    // The REAL exported statuses stay active/graded: a test_attempt row is a
    // deterministic objective grade and always final; the provisional kind
    // exists only as the typed GradeDecision variant no writer produces.
    expect(attemptStatuses).toEqual(['active', 'graded']);
    expect(attemptStatuses).not.toContain('provisional');
    // Every ledgered recovery target still clears only through retest
    // evidence — a provisional nothing cannot satisfy the requirement.
    expect(recoverySatisfied([{ status: 'open' }, { status: 'cleared' }])).toBe(false);
    expect(recoverySatisfied([{ status: 'cleared' }, { status: 'cleared' }])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Story 5 — evidence-linked gap guidance (pure derivation) and the flag
// command surface.
// ---------------------------------------------------------------------------

import { deriveGuidance } from '../../src/modules/assessment-progress/guidance';
import { GUIDANCE_UNCERTAINTY_NOTE, flagAssessmentItemSchema } from '../../src/contracts/assessment';
import type { AttemptRow, RecoveryTargetRow, RetestRow } from '../../src/modules/assessment-progress/repository';

const correctOn = (snapshot: { items: Array<{ position: number; answerId: string }> }, positions: number[]) =>
  snapshot.items.filter(item => positions.includes(item.position)).map(item => ({ position: item.position, choiceId: item.answerId }));
const wrongOn = (snapshot: { items: Array<{ position: number; answerId: string; choices: Array<{ id: string }> }> }, positions: number[]) =>
  snapshot.items.filter(item => positions.includes(item.position)).map(item => ({ position: item.position, choiceId: item.choices.find(choice => choice.id !== item.answerId)!.id }));
const attemptRowOf = (snapshot: AttemptSnapshot, course: string, answers: Array<{ position: number; choiceId: string }>, created: Date): AttemptRow => ({
  id: crypto.randomUUID(), root_id: crypto.randomUUID(), owner_id: crypto.randomUUID(), course_id: course, course_version: 1,
  plan_revision_id: crypto.randomUUID(), status: 'graded', snapshot, answers,
  earned_points: 0, total_points: snapshot.totalPoints, passed: false, created_at: created, graded_at: created,
});
const targetRowOf = (attemptId: string, course: string, index: number, total: number): RecoveryTargetRow => ({
  id: crypto.randomUUID(), root_attempt_id: attemptId, owner_id: crypto.randomUUID(), root_id: crypto.randomUUID(),
  course_id: course, course_version: 1, objective_index: index, objective: `Synthetic objective ${index + 1}`,
  initial_earned: 0, initial_total: total, status: 'open', cleared_by: null, cleared_at: null, created_at: new Date('2026-10-29T08:00:00Z'),
});

describe('story 5: guidance classification — Needs practice vs Unknown', () => {
  it('cites exactly the failed groups non-perfect items and orders needs-practice before unknown', () => {
    // objectives(2): items map [0,1,0,1,0] — obj0 items 1/3/5 (6002 pts), obj1 items 2/4 (3998 pts).
    const snapshot = buildSnapshot(objectives(2));
    const failed = attemptRowOf(snapshot, 'course-studied', [...correctOn(snapshot, [1, 3, 5]), ...wrongOn(snapshot, [2, 4])], new Date('2026-10-29T08:00:00Z'));
    const guidance = deriveGuidance({
      objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [failed],
      targets: [targetRowOf(failed.id, 'course-studied', 1, 3998)], retests: [], practiceSummaries: [], practiceLatestIncorrect: [],
    });
    // Exactly the failed group lists, cause unnamed; no Unknown (both covered).
    expect(guidance?.entries).toHaveLength(1);
    const entry = guidance!.entries[0];
    expect(entry.status).toBe('needs-practice');
    expect(entry.objectiveIndex).toBe(1);
    expect(entry.scored.map(citation => ({ source: citation.source, position: citation.position, earned: citation.earned })))
      .toEqual([{ source: 'attempt', position: 2, earned: 0 }, { source: 'attempt', position: 4, earned: 0 }]);
    expect(entry.objective).toBe('Synthetic objective 2');
  });

  it('marks uncovered objectives Unknown, never Needs practice — even with incorrect practice on them', () => {
    // objectives(8): the 5-item blueprint covers indexes 0..4; 5..7 are unassessed.
    const snapshot = buildSnapshot(objectives(8));
    const failed = attemptRowOf(snapshot, 'course-studied', wrongOn(snapshot, [1, 2, 3, 4, 5]), new Date('2026-10-29T08:00:00Z'));
    const guidance = deriveGuidance({
      objectives: objectives(8), studiedCourseId: 'course-studied', attempts: [failed],
      targets: [0, 1, 2, 3, 4].map(index => targetRowOf(failed.id, 'course-studied', index, snapshot.items[index].points)),
      retests: [], practiceSummaries: [
        { objectiveIndex: 6, evidenceKind: 'unaided', outcome: 'correct', count: 1 },
        { objectiveIndex: 6, evidenceKind: 'assisted', outcome: 'incorrect', count: 2 },
      ],
      practiceLatestIncorrect: [{ objectiveIndex: 6, attempted: 'fixpoint combinator', evidenceKind: 'assisted', submittedAt: new Date('2026-10-29T09:00:00Z') }],
    });
    const statuses = guidance!.entries.map(entry => [entry.objectiveIndex, entry.status]);
    expect(statuses).toEqual([[0, 'needs-practice'], [1, 'needs-practice'], [2, 'needs-practice'], [3, 'needs-practice'], [4, 'needs-practice'], [5, 'unknown'], [6, 'unknown'], [7, 'unknown']]);
    // Practice NEVER reclassifies: index 6 stays Unknown with its labeled lane.
    const practiced = guidance!.entries[6];
    expect(practiced.status).toBe('unknown');
    expect(practiced.scored).toEqual([]);
    expect(practiced.practice).toEqual({
      unaidedCorrect: 1, unaidedIncorrect: 0, assistedCorrect: 0, assistedIncorrect: 2,
      latestIncorrect: { attempted: 'fixpoint combinator', evidenceKind: 'assisted', submittedAt: '2026-10-29T09:00:00.000Z' },
    });
    // The unpracticed Unknown objective renders no empty lane.
    expect(guidance!.entries[5].practice).toBeNull();
    // The uncertainty note states the limits in text.
    expect(guidance!.note).toBe(GUIDANCE_UNCERTAINTY_NOTE);
    expect(GUIDANCE_UNCERTAINTY_NOTE).toContain('does not claim a cause');
    expect(GUIDANCE_UNCERTAINTY_NOTE).toContain('not yet assessed, not weakness');
  });

  it('suppresses still-failed listings once a NEWER passing attempt covered them (recovered normally)', () => {
    const snapshot = buildSnapshot(objectives(2));
    const failed = attemptRowOf(snapshot, 'course-studied', wrongOn(snapshot, [1, 2, 3, 4, 5]), new Date('2026-10-29T08:00:00Z'));
    const passedLater: AttemptRow = { ...attemptRowOf(snapshot, 'course-studied', correctOn(snapshot, [1, 2, 3, 4, 5]), new Date('2026-10-29T10:00:00Z')), passed: true, earned_points: snapshot.totalPoints };
    const input = {
      objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [passedLater, failed],
      targets: [targetRowOf(failed.id, 'course-studied', 0, 6002), targetRowOf(failed.id, 'course-studied', 1, 3998)], retests: [], practiceSummaries: [], practiceLatestIncorrect: [],
    };
    // A pass AFTER the failure satisfies the requirement normally: nothing
    // needs attention, everything is covered — no guidance renders.
    expect(deriveGuidance(input)).toBeNull();
    // A pass BEFORE the failure (the learner failed a later retake) leaves the
    // failed groups honestly still-failed — order is what matters, not presence.
    const passedEarlier: AttemptRow = { ...passedLater, created_at: new Date('2026-10-29T07:00:00Z'), graded_at: new Date('2026-10-29T07:00:00Z') };
    const earlier = deriveGuidance({ ...input, attempts: [failed, passedEarlier] });
    expect(earlier?.entries.map(entry => [entry.objectiveIndex, entry.status])).toEqual([[0, 'needs-practice'], [1, 'needs-practice']]);
  });

  it('scopes every derivation to the studied release and renders nothing without evidence', () => {
    const snapshot = buildSnapshot(objectives(2));
    const otherRelease = attemptRowOf(snapshot, 'course-other', wrongOn(snapshot, [1, 2, 3, 4, 5]), new Date('2026-10-29T08:00:00Z'));
    // No evidence on the studied release at all: no guidance.
    expect(deriveGuidance({ objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [otherRelease], targets: [targetRowOf(otherRelease.id, 'course-other', 1, 3998)], retests: [], practiceSummaries: [], practiceLatestIncorrect: [] })).toBeNull();
    // Practice-only evidence makes guidance exist — all objectives honestly
    // Unknown, the practiced one carrying its labeled lane.
    const practiceOnly = deriveGuidance({
      objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [otherRelease], targets: [], retests: [],
      practiceSummaries: [{ objectiveIndex: 0, evidenceKind: 'unaided', outcome: 'incorrect', count: 3 }],
      practiceLatestIncorrect: [{ objectiveIndex: 0, attempted: 'closure capture', evidenceKind: 'unaided', submittedAt: new Date('2026-10-29T09:30:00Z') }],
    });
    expect(practiceOnly?.entries.map(entry => [entry.objectiveIndex, entry.status])).toEqual([[0, 'unknown'], [1, 'unknown']]);
    expect(practiceOnly?.entries[0].practice?.unaidedIncorrect).toBe(3);
    // And an empty evidence world is null even with objectives present.
    expect(deriveGuidance({ objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [], targets: [], retests: [], practiceSummaries: [], practiceLatestIncorrect: [] })).toBeNull();
  });
});

describe('story 5: partial-recovery citations and practice-lane separation', () => {
  it('cites root-attempt and failed-retest items with their sources labeled', () => {
    const snapshot = buildSnapshot(objectives(2));
    const failed = attemptRowOf(snapshot, 'course-studied', [...correctOn(snapshot, [1, 3, 5]), ...wrongOn(snapshot, [2, 4])], new Date('2026-10-29T08:00:00Z'));
    const retestSnapshot = buildRetestSnapshot(snapshot, [1]);
    const retest: RetestRow = {
      id: crypto.randomUUID(), root_attempt_id: failed.id, root_id: failed.root_id, owner_id: failed.owner_id,
      course_id: 'course-studied', course_version: 1, plan_revision_id: failed.plan_revision_id, status: 'graded',
      target_objective_indexes: [1], snapshot: retestSnapshot, answers: wrongOn(retestSnapshot, retestSnapshot.items.map(item => item.position)),
      group_results: [{ objectiveIndex: 1, earned: 0, total: 3998, cleared: false }], created_at: new Date('2026-10-29T09:00:00Z'), graded_at: new Date('2026-10-29T09:00:00Z'),
    };
    const guidance = deriveGuidance({
      objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [failed],
      targets: [targetRowOf(failed.id, 'course-studied', 1, 3998)], retests: [retest], practiceSummaries: [], practiceLatestIncorrect: [],
    });
    const citations = guidance!.entries[0].scored;
    expect(citations.map(citation => `${citation.source}:${citation.position}`)).toEqual(['attempt:2', 'attempt:4', 'targeted-retest:1', 'targeted-retest:2']);
    expect(citations.every(citation => citation.earned === 0 && citation.points > 0)).toBe(true);
  });

  it('never folds practice counts into scored citations on a needs-practice group', () => {
    const snapshot = buildSnapshot(objectives(2));
    const failed = attemptRowOf(snapshot, 'course-studied', [...correctOn(snapshot, [1, 3, 5]), ...wrongOn(snapshot, [2, 4])], new Date('2026-10-29T08:00:00Z'));
    const guidance = deriveGuidance({
      objectives: objectives(2), studiedCourseId: 'course-studied', attempts: [failed],
      targets: [targetRowOf(failed.id, 'course-studied', 1, 3998)], retests: [],
      practiceSummaries: [{ objectiveIndex: 1, evidenceKind: 'assisted', outcome: 'correct', count: 2 }, { objectiveIndex: 1, evidenceKind: 'unaided', outcome: 'incorrect', count: 1 }],
      practiceLatestIncorrect: [{ objectiveIndex: 1, attempted: 'tail recursion', evidenceKind: 'unaided', submittedAt: new Date('2026-10-29T09:10:00Z') }],
    });
    const entry = guidance!.entries[0];
    // The scored citations stay exactly the two failed attempt items — the
    // practice evidence renders in its own labeled lane, structurally apart.
    expect(entry.scored).toHaveLength(2);
    expect(entry.scored.every(citation => citation.source === 'attempt')).toBe(true);
    expect(entry.practice).toEqual({
      unaidedCorrect: 0, unaidedIncorrect: 1, assistedCorrect: 2, assistedIncorrect: 0,
      latestIncorrect: { attempted: 'tail recursion', evidenceKind: 'unaided', submittedAt: '2026-10-29T09:10:00.000Z' },
    });
  });
});

describe('story 5: the one-way flag command surface', () => {
  it('accepts exactly the graded-container pointer and nothing forged', () => {
    const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 3 };
    const evidenceId = crypto.randomUUID();
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'attempt', evidenceId, position: 2 }).success).toBe(true);
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'retest', evidenceId, position: 1 }).success).toBe(true);
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'attempt', evidenceId, position: 0 }).success).toBe(false);
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'attempt', evidenceId, position: 1.5 }).success).toBe(false);
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'diagnostic', evidenceId, position: 1 }).success).toBe(false);
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'attempt', evidenceId, position: 1, unclear: true }).success).toBe(false);
    expect(flagAssessmentItemSchema.safeParse({ ...command, evidenceKind: 'attempt', position: 1 }).success).toBe(false);
  });
});
