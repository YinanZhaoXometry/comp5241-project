import { describe, expect, it } from 'vitest';
import {
  DAILY_GENERATION_LIMIT,
  REPLACEMENT_TEST_ID,
  disputeStatuses,
  replacementSnapshotSchema,
  startReplacementSchema,
  submitReplacementSchema,
  type AttemptSnapshot,
} from '../../src/contracts/assessment';
import { buildPartialCreditSnapshot, buildReplacementSnapshot, buildRetestSnapshot, buildSnapshot } from '../../src/modules/assessment-progress/bank';
import { deriveCompletionPause, GENERATION_DELAY_NOTICE, generationAllows, generationUseView, recoverySatisfiedWithCorrections } from '../../src/modules/assessment-progress/disputes';
import { groupCleared, groupResultsOf, recoverySatisfied } from '../../src/modules/assessment-progress/scoring';
import type { AttemptRow, DisputeRow, RecoveryTargetRow, RetestRow } from '../../src/modules/assessment-progress/repository';

// Unit coverage of epic-3 story 7's pure dispute-correction surface: the
// pause predicate (which pending/unearned completion decisions pause while
// an open dispute could affect them — and which never touch earned
// anything), the additive corrected-satisfaction predicate (byte-identical
// to 3.2's with zero disputes), the manually authored replacement pool
// (D7 fixture validity: fresh prompts distinct from BOTH earlier pools,
// one-for-one blueprint mirroring, root policy pinned), the strict command
// schemas, and the honest quota-delay contract (named limit, saved work,
// zero attempt records, never an unlimited-generation promise).

const objectives = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ index, text: `Synthetic objective ${index + 1}` }));

// -- Row factories (minimal server-side shapes over real bank snapshots). --

const snapshotOf = (count: number): AttemptSnapshot => buildSnapshot(objectives(count));

function attemptRow(overrides: Partial<AttemptRow> & { id: string; courseId?: string }): AttemptRow {
  return {
    id: overrides.id,
    root_id: 'root-1',
    owner_id: 'owner-1',
    course_id: overrides.courseId ?? 'course-1',
    course_version: 1,
    plan_revision_id: 'plan-1',
    status: 'graded',
    snapshot: overrides.snapshot ?? snapshotOf(5),
    answers: [],
    earned_points: overrides.earned_points ?? 0,
    total_points: overrides.total_points ?? 10000,
    passed: overrides.passed ?? false,
    created_at: overrides.created_at ?? new Date('2026-10-29T10:00:00Z'),
    graded_at: new Date('2026-10-29T10:05:00Z'),
  };
}

function targetRow(rootAttemptId: string, objectiveIndex: number, status: 'open' | 'cleared'): RecoveryTargetRow {
  return {
    id: `target-${rootAttemptId}-${objectiveIndex}`,
    root_attempt_id: rootAttemptId,
    owner_id: 'owner-1',
    root_id: 'root-1',
    course_id: 'course-1',
    course_version: 1,
    objective_index: objectiveIndex,
    objective: `Synthetic objective ${objectiveIndex + 1}`,
    initial_earned: 0,
    initial_total: 2004,
    status,
    cleared_by: status === 'cleared' ? 'retest-1' : null,
    cleared_at: status === 'cleared' ? new Date('2026-10-29T11:00:00Z') : null,
    created_at: new Date('2026-10-29T10:05:00Z'),
  };
}

function disputeRow(overrides: Partial<DisputeRow> & { attemptId: string }): DisputeRow {
  return {
    id: overrides.id ?? `dispute-${overrides.attemptId}-${overrides.objective_index ?? 0}`,
    flag_id: overrides.flag_id ?? `flag-${overrides.attemptId}`,
    root_id: 'root-1',
    owner_id: 'owner-1',
    attempt_id: overrides.attemptId,
    retest_id: overrides.retest_id ?? null,
    position: overrides.position ?? 5,
    course_id: overrides.course_id ?? 'course-1',
    course_version: 1,
    objective_index: overrides.objective_index ?? 4,
    objective: 'Synthetic objective 5',
    status: overrides.status ?? 'under-review',
    opened_at: new Date('2026-10-29T12:00:00Z'),
    resolved_at: overrides.resolved_at ?? null,
    resolved_by_replacement: overrides.resolved_by_replacement ?? null,
  };
}

// A retest row is only needed as a dispute's retest_id carrier here (chain
// taint keys on the dispute's attempt_id — the chain's root attempt).
function retestRowOf(rootAttemptId: string): RetestRow {
  return {
    id: `retest-${rootAttemptId}`,
    root_attempt_id: rootAttemptId,
    root_id: 'root-1',
    owner_id: 'owner-1',
    course_id: 'course-1',
    course_version: 1,
    plan_revision_id: 'plan-1',
    status: 'graded',
    target_objective_indexes: [4],
    snapshot: buildRetestSnapshot(snapshotOf(5), [4]),
    answers: [],
    group_results: [{ objectiveIndex: 4, earned: 2004, total: 2004, cleared: true }],
    created_at: new Date('2026-10-29T11:00:00Z'),
    graded_at: new Date('2026-10-29T11:01:00Z'),
  };
}

describe('pause predicate: which pending decisions pause', () => {
  it('pauses nothing with zero disputes (the pre-3.7 world byte-identical)', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed], targets: [targetRow('a1', 4, 'open')], disputes: [] })).toBe(false);
  });
  it('pauses the affected release while a failed attempt with an open target is disputed', () => {
    // The 79.96% borderline case: the failed attempt's deciding item flagged.
    const failed = attemptRow({ id: 'a1', passed: false });
    const open = disputeRow({ attemptId: 'a1', objective_index: 4 });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed], targets: [targetRow('a1', 4, 'open')], disputes: [open] })).toBe(true);
  });
  it('pauses ONLY the affected release — another release completes unaffected', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    const open = disputeRow({ attemptId: 'a1', objective_index: 4 });
    expect(deriveCompletionPause({ courseId: 'course-2', attempts: [failed], targets: [targetRow('a1', 4, 'open')], disputes: [open] })).toBe(false);
  });
  it('pauses a pending decision that would rest on a disputed PASS (the pass itself is never revoked)', () => {
    const pass = attemptRow({ id: 'a1', passed: true, earned_points: 8000 });
    const open = disputeRow({ attemptId: 'a1', objective_index: 4 });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [pass], targets: [], disputes: [open] })).toBe(true);
    // The predicate has NO award input at all: there is no channel through
    // which it could touch an earned row — pause only gates a future insert.
  });
  it('does not pause when an undisputed passing attempt can carry the decision', () => {
    const disputed = attemptRow({ id: 'a1', passed: true, earned_points: 8000 });
    const clean = attemptRow({ id: 'a2', passed: true, earned_points: 9000 });
    const open = disputeRow({ attemptId: 'a1', objective_index: 4 });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [disputed, clean], targets: [], disputes: [open] })).toBe(false);
  });
  it('does not pause when a newer clean pass exists beside an old disputed failure', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    const pass = attemptRow({ id: 'a2', passed: true, earned_points: 8500 });
    const open = disputeRow({ attemptId: 'a1', objective_index: 4 });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed, pass], targets: [targetRow('a1', 4, 'open')], disputes: [open] })).toBe(false);
  });
  it('a dispute on a chain retest taints that chain: a fully-cleared recovery pauses', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    const retest = retestRowOf('a1');
    const open = disputeRow({ attemptId: 'a1', retest_id: retest.id, objective_index: 4 });
    // The retest cleared the last target; the dispute questions its item.
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed], targets: [targetRow('a1', 4, 'cleared')], disputes: [open] })).toBe(true);
  });
  it('a corrected dispute does not pause: the decision resumes from retained evidence', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    const corrected = disputeRow({ attemptId: 'a1', objective_index: 4, status: 'corrected', resolved_at: new Date('2026-10-29T13:00:00Z'), resolved_by_replacement: 'replacement-1' });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed], targets: [targetRow('a1', 4, 'open')], disputes: [corrected] })).toBe(false);
  });
  it('a fully-corrected recovery with no open disputes is a clean path (no pause)', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    const corrected = disputeRow({ attemptId: 'a1', objective_index: 4, status: 'corrected', resolved_at: new Date('2026-10-29T13:00:00Z'), resolved_by_replacement: 'replacement-1' });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed], targets: [targetRow('a1', 4, 'open')], disputes: [corrected] })).toBe(false);
  });
  it('a still-open sibling dispute keeps the pause even when one dispute corrected', () => {
    const failed = attemptRow({ id: 'a1', passed: false });
    const corrected = disputeRow({ id: 'd1', flag_id: 'f1', attemptId: 'a1', objective_index: 3, status: 'corrected', resolved_at: new Date('2026-10-29T13:00:00Z'), resolved_by_replacement: 'replacement-1' });
    const open = disputeRow({ id: 'd2', flag_id: 'f2', attemptId: 'a1', objective_index: 4 });
    expect(deriveCompletionPause({ courseId: 'course-1', attempts: [failed], targets: [targetRow('a1', 3, 'open'), targetRow('a1', 4, 'open')], disputes: [corrected, open] })).toBe(true);
  });
});

describe('corrected satisfaction: the additive requirement predicate', () => {
  it('is byte-identical to 3.2 recoverySatisfied with zero corrections', () => {
    const targets = [targetRow('a1', 3, 'cleared'), targetRow('a1', 4, 'open')];
    expect(recoverySatisfiedWithCorrections(targets, [])).toBe(recoverySatisfied(targets));
    expect(recoverySatisfiedWithCorrections([], [])).toBe(recoverySatisfied([]));
    const allCleared = [targetRow('a1', 3, 'cleared'), targetRow('a1', 4, 'cleared')];
    expect(recoverySatisfiedWithCorrections(allCleared, [])).toBe(recoverySatisfied(allCleared));
    expect(recoverySatisfiedWithCorrections(allCleared, [])).toBe(true);
  });
  it('a corrected dispute on the same (root attempt, group) satisfies that open target', () => {
    const corrected = disputeRow({ attemptId: 'a1', objective_index: 4, status: 'corrected', resolved_at: new Date(), resolved_by_replacement: 'r1' });
    expect(recoverySatisfiedWithCorrections([targetRow('a1', 4, 'open')], [corrected])).toBe(true);
  });
  it('corrections on a different group or a different attempt satisfy nothing', () => {
    const otherGroup = disputeRow({ attemptId: 'a1', objective_index: 3, status: 'corrected', resolved_at: new Date(), resolved_by_replacement: 'r1' });
    expect(recoverySatisfiedWithCorrections([targetRow('a1', 4, 'open')], [otherGroup])).toBe(false);
    const otherAttempt = disputeRow({ attemptId: 'a2', objective_index: 4, status: 'corrected', resolved_at: new Date(), resolved_by_replacement: 'r1' });
    expect(recoverySatisfiedWithCorrections([targetRow('a1', 4, 'open')], [otherAttempt])).toBe(false);
    const underReview = disputeRow({ attemptId: 'a1', objective_index: 4 });
    expect(recoverySatisfiedWithCorrections([targetRow('a1', 4, 'open')], [underReview])).toBe(false);
  });
  it('every target must be cleared OR corrected — an uncorrected open target blocks', () => {
    const correctedOn3 = disputeRow({ attemptId: 'a1', objective_index: 3, status: 'corrected', resolved_at: new Date(), resolved_by_replacement: 'r1' });
    expect(recoverySatisfiedWithCorrections([targetRow('a1', 3, 'open'), targetRow('a1', 4, 'open')], [correctedOn3])).toBe(false);
    // Mixed coverage satisfies: cleared by retest + corrected by replacement.
    const correctedOn4 = disputeRow({ attemptId: 'a1', objective_index: 4, status: 'corrected', resolved_at: new Date(), resolved_by_replacement: 'r2' });
    expect(recoverySatisfiedWithCorrections([targetRow('a1', 3, 'cleared'), targetRow('a1', 4, 'open')], [correctedOn4])).toBe(true);
  });
});

describe('replacement bank (D7 fixture) and snapshot builder', () => {
  it('mirrors the disputed group one-for-one: same items, points and objective, positions renumbered', () => {
    const root = snapshotOf(2); // objectives 0 and 1; items map 0,1,0,1,0 -> group 0 has 3 items (1999+1999+2004), group 1 has 2 (1999+1999)
    const rootGroup = root.items.filter(item => item.objectiveIndex === 0);
    const replacement = buildReplacementSnapshot(root, 0);
    expect(replacement.testId).toBe(REPLACEMENT_TEST_ID);
    expect(replacement.items.map(item => item.position)).toEqual(rootGroup.map((_, index) => index + 1));
    expect(replacement.items.map(item => item.points)).toEqual(rootGroup.map(item => item.points));
    expect(replacement.items.map(item => item.objectiveIndex)).toEqual(rootGroup.map(() => 0));
    expect(replacement.totalPoints).toBe(rootGroup.reduce((sum, item) => sum + item.points, 0));
    expect(replacement.items.every(item => item.prompt.length > 0)).toBe(true);
  });
  it('uses prompts distinct from BOTH earlier pools (root and retest) — never a repeat question', () => {
    const root = snapshotOf(5);
    const group = 4;
    const retest = buildRetestSnapshot(root, [group]);
    const replacement = buildReplacementSnapshot(root, group);
    const retestPrompts = new Set(retest.items.map(item => item.prompt));
    const rootPrompts = new Set(root.items.map(item => item.prompt));
    for (const item of replacement.items) {
      expect(retestPrompts.has(item.prompt)).toBe(false);
      expect(rootPrompts.has(item.prompt)).toBe(false);
    }
  });
  it('pins the ROOT policy: pass mark, answer rule, rubric, override and point scale ride unchanged', () => {
    const root = snapshotOf(5);
    const replacement = buildReplacementSnapshot(root, 4);
    expect(replacement.passMarkPercent).toBe(root.passMarkPercent);
    expect(replacement.answerRule).toBe(root.answerRule);
    expect(replacement.rubric).toBe(root.rubric);
    expect(replacement.passMarkOverride).toEqual(root.passMarkOverride);
    expect(replacement.pointsScale).toBe(root.pointsScale);
  });
  it('parses under its own schema (sequential positions, points sum, override agreement, no rubrics)', () => {
    const replacement = buildReplacementSnapshot(snapshotOf(5), 4);
    expect(replacementSnapshotSchema.safeParse(replacement).success).toBe(true);
  });
  it('rejects a foreign objective index and an unmirrorable (partial-credit) root — never repaired', () => {
    const root = snapshotOf(5);
    expect(() => buildReplacementSnapshot(root, 7)).toThrow();
    // The partial-credit fixture's items (600000/400000) match no pool slot.
    expect(() => buildReplacementSnapshot(buildPartialCreditSnapshot(objectives(2)), 0)).toThrow();
  });
  it('grades by the same cross-product: correct clears at the 80% mark, wrong does not', () => {
    const root = snapshotOf(5);
    const replacement = buildReplacementSnapshot(root, 4);
    const correct = groupResultsOf(replacement, replacement.items.map(item => ({ position: item.position, choiceId: item.answerId })));
    expect(correct).toHaveLength(1);
    expect(groupCleared(correct[0]!, replacement.passMarkPercent)).toBe(true);
    const wrong = groupResultsOf(replacement, replacement.items.map(item => ({ position: item.position, choiceId: item.choices.find(choice => choice.id !== item.answerId)!.id })));
    expect(groupCleared(wrong[0]!, replacement.passMarkPercent)).toBe(false);
  });
});

describe('strict command schemas', () => {
  const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
  it('startReplacement takes exactly the dispute id', () => {
    expect(startReplacementSchema.safeParse({ ...command, disputeId: crypto.randomUUID() }).success).toBe(true);
    expect(startReplacementSchema.safeParse({ ...command, disputeId: 'not-a-uuid' }).success).toBe(false);
    expect(startReplacementSchema.safeParse({ ...command, disputeId: crypto.randomUUID(), extra: true }).success).toBe(false);
    expect(startReplacementSchema.safeParse(command).success).toBe(false);
  });
  it('submitReplacement takes the replacement id and 0..5 answers of (position, choiceId)', () => {
    expect(submitReplacementSchema.safeParse({ ...command, replacementId: crypto.randomUUID(), answers: [] }).success).toBe(true);
    expect(submitReplacementSchema.safeParse({ ...command, replacementId: crypto.randomUUID(), answers: [{ position: 1, choiceId: 'b' }] }).success).toBe(true);
    expect(submitReplacementSchema.safeParse({ ...command, replacementId: crypto.randomUUID(), answers: [{ position: 0, choiceId: 'b' }] }).success).toBe(false);
    expect(submitReplacementSchema.safeParse({ ...command, replacementId: crypto.randomUUID(), answers: [{ position: 1 }] }).success).toBe(false);
    expect(submitReplacementSchema.safeParse({ ...command, replacementId: 'x', answers: [] }).success).toBe(false);
  });
  it('the dispute lifecycle is exactly the two personal-study states', () => {
    expect(disputeStatuses).toEqual(['under-review', 'corrected']);
  });
});

describe('honest quota-delay contract (D3 retries)', () => {
  it('the budget is a named constant: inclusive cap — exactly 20 starts commit, the 21st denies (review disposition 2026-10-29)', () => {
    expect(DAILY_GENERATION_LIMIT).toBe(20);
    expect(generationAllows(0)).toBe(true);
    expect(generationAllows(19)).toBe(true);
    expect(generationAllows(20)).toBe(true);
    expect(generationAllows(21)).toBe(false);
  });
  it('the served generation view states the limit and today’s use', () => {
    expect(generationUseView(7)).toEqual({ dailyLimit: DAILY_GENERATION_LIMIT, usedToday: 7 });
    expect(generationUseView(0)).toEqual({ dailyLimit: DAILY_GENERATION_LIMIT, usedToday: 0 });
  });
  it('the delay notice states the limit, the reset, saved work and zero attempt records — and never promises unlimited generation', () => {
    expect(GENERATION_DELAY_NOTICE).toContain(`${DAILY_GENERATION_LIMIT} per day`);
    expect(GENERATION_DELAY_NOTICE).toContain('Try again tomorrow');
    expect(GENERATION_DELAY_NOTICE).toContain('saved and unchanged');
    expect(GENERATION_DELAY_NOTICE).toContain('no failed attempt was recorded');
    // Retaking the test itself stays unlimited — the pedagogical channel is
    // never limited; the resource channel is named, never "unlimited free".
    expect(GENERATION_DELAY_NOTICE).toContain('never limited');
    expect(GENERATION_DELAY_NOTICE).not.toMatch(/unlimited free/i);
  });
});
