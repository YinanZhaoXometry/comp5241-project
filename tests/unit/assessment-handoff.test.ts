import { describe, expect, it } from 'vitest';
import { DEFAULT_PASS_MARK_OVERRIDE, handoffFieldNames, parseHandoffFields } from '../../src/contracts/assessment';
import { buildSnapshot } from '../../src/modules/assessment-progress/bank';
import { deriveEvaluatorVerdict, deriveHandoffDocument, type EvaluatorVerdictInput, type HandoffInput } from '../../src/modules/assessment-progress/handoff';
import type { AttemptRow, AwardRow, DisputeRow, RecoveryTargetRow } from '../../src/modules/assessment-progress/repository';

// Unit coverage of the epic-3 story-8 pure handoff derivations: the AD-13
// shared evaluator verdict (demonstrated exactly on a clean final pass or a
// fully cleared-or-corrected recovery, the shared 3.7 pause rule, the pinned
// policy chain, unaided-only inputs), the versioned document blocks (awards
// + parent pins, applicable pass-mark snapshots, AD-14 reporting projections
// with the provisional-grade contract, the activity/rubric/completion links
// epic 6 extends), supersession stability of the pure derivation (pinned
// inputs unchanged -> value-identical output; other-release rows never
// enter), evidence monotonicity (new attempts append, never rewrite), and
// the strict fields= scope-declaration contract (out-of-scope names are
// refused before anything is read).

const objectives = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ index, text: `Synthetic objective ${index + 1}` }));

const publishedSnapshot = buildSnapshot(objectives(3));
const pinnedSnapshot = buildSnapshot(objectives(3), { source: 'instructor', value: 75, recordedAt: '2026-10-28T08:00:00Z' });

function attemptRow(over: Partial<AttemptRow> & Pick<AttemptRow, 'id' | 'root_id' | 'course_id'>): AttemptRow {
  return {
    owner_id: 'owner',
    course_version: 1,
    plan_revision_id: 'plan-1',
    status: 'graded',
    snapshot: publishedSnapshot,
    answers: [],
    earned_points: 0,
    total_points: publishedSnapshot.totalPoints,
    passed: false,
    created_at: new Date('2026-10-29T10:00:00Z'),
    graded_at: new Date('2026-10-29T10:01:00Z'),
    ...over,
  };
}

function targetRow(rootAttemptId: string, objectiveIndex: number, status: 'open' | 'cleared'): RecoveryTargetRow {
  return {
    id: `target-${rootAttemptId}-${objectiveIndex}-${status}`,
    root_attempt_id: rootAttemptId,
    owner_id: 'owner',
    root_id: 'root-1',
    course_id: 'course-v1',
    course_version: 1,
    objective_index: objectiveIndex,
    objective: `Synthetic objective ${objectiveIndex + 1}`,
    initial_earned: 0,
    initial_total: 10000,
    status,
    cleared_by: status === 'cleared' ? 'retest-1' : null,
    cleared_at: status === 'cleared' ? new Date('2026-10-29T11:00:00Z') : null,
    created_at: new Date('2026-10-29T10:01:00Z'),
  };
}

function disputeRow(over: Partial<DisputeRow> & Pick<DisputeRow, 'id' | 'attempt_id'>): DisputeRow {
  return {
    flag_id: `flag-${over.id}`,
    root_id: 'root-1',
    owner_id: 'owner',
    retest_id: null,
    position: 1,
    course_id: 'course-v1',
    course_version: 1,
    objective_index: 0,
    objective: 'Synthetic objective 1',
    status: 'under-review',
    opened_at: new Date('2026-10-29T12:00:00Z'),
    resolved_at: null,
    resolved_by_replacement: null,
    ...over,
  };
}

function miniAwardRow(courseId: string): AwardRow {
  return {
    id: `award-${courseId}`,
    owner_id: 'owner',
    root_id: 'root-1',
    kind: 'mini-course',
    course_id: courseId,
    course_version: 1,
    plan_revision_id: 'plan-1',
    manifest_id: null,
    manifest: null,
    awarded_at: new Date('2026-10-29T13:00:00Z'),
    created_at: new Date('2026-10-29T13:00:00Z'),
  };
}

function manifestRow(manifestId: string, children: Array<{ courseId: string; required: boolean }>, awarded = false): AwardRow {
  return {
    id: `row-${manifestId}`,
    owner_id: 'owner',
    root_id: 'root-1',
    kind: 'parent-path',
    course_id: null,
    course_version: null,
    plan_revision_id: null,
    manifest_id: manifestId,
    manifest: { schemaVersion: 1, children },
    awarded_at: awarded ? new Date('2026-10-29T14:00:00Z') : null,
    created_at: new Date('2026-10-29T09:00:00Z'),
  };
}

const publishedPolicy = {
  passMarkPercent: publishedSnapshot.passMarkPercent,
  passMarkOverride: DEFAULT_PASS_MARK_OVERRIDE,
  answerRule: publishedSnapshot.answerRule,
  rubric: publishedSnapshot.rubric,
};

function verdictInput(over: Partial<EvaluatorVerdictInput> = {}): EvaluatorVerdictInput {
  return {
    courseId: 'course-v1',
    courseVersion: 1,
    publishedPolicy,
    attempts: [],
    targets: [],
    disputes: [],
    award: null,
    ...over,
  };
}

function documentInput(over: Partial<HandoffInput> = {}): HandoffInput {
  return {
    release: { courseId: 'course-v1', version: 1, planRevisionId: 'plan-1' },
    publishedSnapshot,
    trackerItems: [
      { id: 'lesson:1:reading', required: true },
      { id: 'lesson:2:reading', required: true },
      { id: 'enrichment:1', required: false },
    ],
    attempts: [],
    targets: [],
    disputes: [],
    award: null,
    parentManifests: [],
    ...over,
  };
}

describe('story-8 fields scope declaration: the contract cannot serve what it does not own', () => {
  it('accepts every contract field name and trims whitespace', () => {
    const parsed = parseHandoffFields(' awards, marks ,evaluator-verdict,reporting,activities ');
    expect(parsed).toEqual({ ok: true, fields: [...handoffFieldNames] });
  });

  it('refuses out-of-scope names, empty segments and empty declarations', () => {
    for (const raw of ['answers', 'scheduling', 'roster', 'attempts', 'due', 'awards,answers', 'answers,awards', 'awards,,marks', '', '   ']) {
      expect(parseHandoffFields(raw)).toEqual({ ok: false });
    }
  });
});

describe('story-8 evaluator verdict: the AD-13 shared truth, unaided only', () => {
  it('reads not-demonstrated with the published policy when nothing was attempted', () => {
    const verdict = deriveEvaluatorVerdict(verdictInput());
    expect(verdict).toMatchObject({
      schemaVersion: 1,
      courseId: 'course-v1',
      courseVersion: 1,
      assistance: 'unaided',
      outcome: 'not-demonstrated',
      basis: null,
      pausedByOpenDispute: false,
      awardAwardedAt: null,
    });
    expect(verdict.policy).toEqual(publishedPolicy);
  });

  it('demonstrates on the newest clean final pass and pins THAT attempt snapshot policy', () => {
    const older = attemptRow({ id: 'attempt-old', root_id: 'root-1', course_id: 'course-v1', passed: true, created_at: new Date('2026-10-29T10:00:00Z') });
    const newer = attemptRow({
      id: 'attempt-new',
      root_id: 'root-1',
      course_id: 'course-v1',
      passed: true,
      snapshot: pinnedSnapshot,
      created_at: new Date('2026-10-29T15:00:00Z'),
      graded_at: new Date('2026-10-29T15:01:00Z'),
    });
    const verdict = deriveEvaluatorVerdict(verdictInput({ attempts: [newer, older] }));
    expect(verdict.outcome).toBe('demonstrated');
    expect(verdict.basis).toEqual({ kind: 'final-pass', attemptId: 'attempt-new' });
    // Root policy pinned: the satisfying attempt's own snapshotted 75-mark
    // wins over the published 80 default (later policy edits affect only
    // later attempts — never a pinned verdict).
    expect(verdict.policy.passMarkPercent).toBe(75);
    expect(verdict.policy.passMarkOverride).toEqual({ source: 'instructor', value: 75, recordedAt: '2026-10-28T08:00:00Z' });
  });

  it('reads not-demonstrated while a recovery target stays open, and demonstrates on full recovery', () => {
    const failed = attemptRow({ id: 'attempt-failed', root_id: 'root-1', course_id: 'course-v1', passed: false });
    const open = deriveEvaluatorVerdict(verdictInput({ attempts: [failed], targets: [targetRow('attempt-failed', 0, 'open')] }));
    expect(open.outcome).toBe('not-demonstrated');
    expect(open.basis).toBeNull();
    const cleared = deriveEvaluatorVerdict(verdictInput({ attempts: [failed], targets: [targetRow('attempt-failed', 0, 'cleared')] }));
    expect(cleared.outcome).toBe('demonstrated');
    expect(cleared.basis).toEqual({ kind: 'full-recovery', attemptId: 'attempt-failed' });
  });

  it('accepts a dispute-corrected group as recovery (the additive predicate) but pauses on an open dispute', () => {
    const failed = attemptRow({ id: 'attempt-failed', root_id: 'root-1', course_id: 'course-v1', passed: false });
    const corrected = disputeRow({ id: 'dispute-1', attempt_id: 'attempt-failed', status: 'corrected' });
    const verdict = deriveEvaluatorVerdict(verdictInput({ attempts: [failed], targets: [targetRow('attempt-failed', 0, 'open')], disputes: [corrected] }));
    expect(verdict.outcome).toBe('demonstrated');
    expect(verdict.basis).toEqual({ kind: 'full-recovery', attemptId: 'attempt-failed' });

    const open = disputeRow({ id: 'dispute-2', attempt_id: 'attempt-p', status: 'under-review' });
    const paused = deriveEvaluatorVerdict(verdictInput({
      attempts: [attemptRow({ id: 'attempt-p', root_id: 'root-1', course_id: 'course-v1', passed: true })],
      disputes: [open],
    }));
    // The passing attempt's own item is disputed: no clean path, the pending
    // decision pauses, the verdict reads honestly not-demonstrated — the
    // earned award, if any, is still served read-only.
    expect(paused.outcome).toBe('not-demonstrated');
    expect(paused.pausedByOpenDispute).toBe(true);
    const withAward = deriveEvaluatorVerdict(verdictInput({
      attempts: [attemptRow({ id: 'attempt-p', root_id: 'root-1', course_id: 'course-v1', passed: true })],
      disputes: [open],
      award: miniAwardRow('course-v1'),
    }));
    expect(withAward.outcome).toBe('not-demonstrated');
    expect(withAward.awardAwardedAt).toBe('2026-10-29T13:00:00.000Z');
  });

  it('lets a clean newer pass escape an older chain dispute, and never reads another release rows', () => {
    const oldFail = attemptRow({ id: 'attempt-old-fail', root_id: 'root-1', course_id: 'course-v1', passed: false, created_at: new Date('2026-10-29T10:00:00Z') });
    const newPass = attemptRow({ id: 'attempt-new-pass', root_id: 'root-1', course_id: 'course-v1', passed: true, created_at: new Date('2026-10-29T16:00:00Z') });
    const oldDispute = disputeRow({ id: 'dispute-3', attempt_id: 'attempt-old-fail', status: 'under-review' });
    const verdict = deriveEvaluatorVerdict(verdictInput({ attempts: [newPass, oldFail], targets: [targetRow('attempt-old-fail', 0, 'open')], disputes: [oldDispute] }));
    expect(verdict.outcome).toBe('demonstrated');
    expect(verdict.basis).toEqual({ kind: 'final-pass', attemptId: 'attempt-new-pass' });
    expect(verdict.pausedByOpenDispute).toBe(false);

    const otherRelease = attemptRow({ id: 'attempt-v2', root_id: 'root-1', course_id: 'course-v2', passed: true });
    const v2Dispute = disputeRow({ id: 'dispute-4', attempt_id: 'attempt-v2', course_id: 'course-v2', status: 'under-review' });
    const isolated = deriveEvaluatorVerdict(verdictInput({ attempts: [otherRelease], disputes: [v2Dispute] }));
    expect(isolated.outcome).toBe('not-demonstrated'); // v2 evidence never demonstrates v1
    expect(isolated.pausedByOpenDispute).toBe(false); // and v2 disputes never pause v1
  });
});

describe('story-8 handoff document: pinned release, awards, marks, reporting and activity links', () => {
  it('serves the release pin, published-policy marks, empty-award honesty and the required-test activity link', () => {
    const document = deriveHandoffDocument(documentInput());
    expect(document.release).toEqual({ courseId: 'course-v1', version: 1, planRevisionId: 'plan-1' });
    expect(document.awards.miniCourse).toBeNull();
    expect(document.awards.parents).toEqual([]);
    expect(document.marks).toEqual([]);
    expect(document.evaluatorVerdict.outcome).toBe('not-demonstrated');
    expect(document.evaluatorVerdict.policy).toEqual(publishedPolicy);
    expect(document.reporting).toEqual({ attempts: [], recovery: null, provisionalGrades: 0 });
    // The epic-6 contract shape: tracker items as required/optional links,
    // the required test as the scored activity with its PUBLISHED rubric.
    expect(document.activities).toHaveLength(4);
    expect(document.activities[0]).toMatchObject({ activityId: 'lesson:1:reading', role: 'required-item', rubric: null, objectiveIndexes: [] });
    expect(document.activities[2]).toMatchObject({ activityId: 'enrichment:1', role: 'optional-activity', rubric: null });
    const testLink = document.activities[3]!;
    expect(testLink).toMatchObject({ schemaVersion: 1, activityId: 'required-test-1', role: 'required-test' });
    expect(testLink.objectiveIndexes).toEqual([...new Set(publishedSnapshot.items.map(item => item.objectiveIndex))].sort((a, b) => a - b));
    expect(testLink.rubric).toMatchObject({ pointsScale: 1, totalPoints: publishedSnapshot.totalPoints, passMarkPercent: 80 });
    // Disclosed policy only: no answer key exists anywhere in the document.
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('answerId');
    expect(serialized).not.toContain('correctChoiceId');
  });

  it('pins one applicable pass-mark snapshot per attempt (active included) and serves award/parent pins read-only', () => {
    const active = attemptRow({ id: 'attempt-active', root_id: 'root-1', course_id: 'course-v1', status: 'active', passed: null, answers: null, earned_points: null, total_points: null, graded_at: null, created_at: new Date('2026-10-29T17:00:00Z') });
    const gradedPinned = attemptRow({ id: 'attempt-graded', root_id: 'root-1', course_id: 'course-v1', snapshot: pinnedSnapshot, passed: true, earned_points: pinnedSnapshot.totalPoints, created_at: new Date('2026-10-29T10:00:00Z') });
    const document = deriveHandoffDocument(documentInput({
      attempts: [active, gradedPinned],
      award: miniAwardRow('course-v1'),
      parentManifests: [
        manifestRow('manifest-1', [{ courseId: 'course-v1', required: true }, { courseId: 'course-other', required: true }], true),
        manifestRow('manifest-2', [{ courseId: 'course-v1', required: false }]),
        manifestRow('manifest-3', [{ courseId: 'course-other', required: true }]),
      ],
    }));
    // Marks: oldest-first, one per attempt, the pinned 75-mark contract
    // carried on the graded row and the default on the active one.
    expect(document.marks.map(mark => mark.attemptId)).toEqual(['attempt-graded', 'attempt-active']);
    expect(document.marks[0]).toMatchObject({ status: 'graded', passMarkPercent: 75, pointsScale: 1 });
    expect(document.marks[0]!.passMarkOverride).toEqual({ source: 'instructor', value: 75, recordedAt: '2026-10-28T08:00:00Z' });
    expect(document.marks[1]).toMatchObject({ status: 'active', passMarkPercent: 80, passMarkOverride: DEFAULT_PASS_MARK_OVERRIDE });
    // Award pins: the monotonic mini-course row read-only; only manifests
    // pinning THIS release serve, with their pin standing and award state.
    expect(document.awards.miniCourse).toMatchObject({ awardId: 'award-course-v1', kind: 'mini-course', courseId: 'course-v1', awardedAt: '2026-10-29T13:00:00.000Z' });
    expect(document.awards.parents).toEqual([
      { manifestId: 'manifest-1', required: true, awardedAt: '2026-10-29T14:00:00.000Z' },
      { manifestId: 'manifest-2', required: false, awardedAt: null },
    ]);
    // Reporting: every graded attempt is a FINAL grade decision (the
    // provisional kind has no writer), active carries no grade, the verdict
    // demonstrates on the clean pass.
    expect(document.reporting.provisionalGrades).toBe(0);
    expect(document.reporting.attempts.map(projection => [projection.attemptId, projection.gradeKind, projection.passed])).toEqual([
      ['attempt-graded', 'final', true],
      ['attempt-active', null, null],
    ]);
    expect(document.reporting.attempts[0]!.displayPercent).toBe('100.0%');
    expect(document.evaluatorVerdict.outcome).toBe('demonstrated');
    expect(document.evaluatorVerdict.awardAwardedAt).toBe('2026-10-29T13:00:00.000Z');
  });

  it('serves the pinned release recovery chain through the shared additive predicate', () => {
    const failed = attemptRow({ id: 'attempt-failed', root_id: 'root-1', course_id: 'course-v1', passed: false });
    const document = deriveHandoffDocument(documentInput({
      attempts: [failed],
      targets: [targetRow('attempt-failed', 1, 'cleared'), targetRow('attempt-failed', 0, 'open')],
    }));
    expect(document.reporting.recovery).toMatchObject({ rootAttemptId: 'attempt-failed', requirementSatisfied: false });
    expect(document.reporting.recovery!.targets.map(target => target.objectiveIndex)).toEqual([0, 1]);
    const corrected = disputeRow({ id: 'dispute-5', attempt_id: 'attempt-failed', objective_index: 0, status: 'corrected' });
    const satisfied = deriveHandoffDocument(documentInput({ attempts: [failed], targets: [targetRow('attempt-failed', 1, 'cleared'), targetRow('attempt-failed', 0, 'open')], disputes: [corrected] }));
    expect(satisfied.reporting.recovery!.requirementSatisfied).toBe(true);
  });

  it('keeps a pinned read value-identical across a superseding release: other-release rows never enter, evidence only appends', () => {
    const graded = attemptRow({ id: 'attempt-1', root_id: 'root-1', course_id: 'course-v1', passed: true, earned_points: publishedSnapshot.totalPoints });
    const before = deriveHandoffDocument(documentInput({ attempts: [graded], award: miniAwardRow('course-v1') }));
    // A superseding release: new course row (v2) with its own attempt — none
    // of it is input to the pinned v1 document.
    const v2Attempt = attemptRow({ id: 'attempt-v2', root_id: 'root-1', course_id: 'course-v2', passed: true, created_at: new Date('2026-10-29T18:00:00Z') });
    const v2Manifest = manifestRow('manifest-v2', [{ courseId: 'course-v2', required: true }]);
    const after = deriveHandoffDocument(documentInput({ attempts: [v2Attempt, graded], award: miniAwardRow('course-v1'), parentManifests: [v2Manifest] }));
    expect(after).toEqual(before);
    // Determinism of the derivation itself.
    expect(deriveHandoffDocument(documentInput({ attempts: [graded], award: miniAwardRow('course-v1') }))).toEqual(before);
    // New evidence ON the pinned release appends: the existing entry is
    // byte-identical, the array grows (the monotonic-derivatives split).
    const retake = attemptRow({ id: 'attempt-retake', root_id: 'root-1', course_id: 'course-v1', passed: true, earned_points: publishedSnapshot.totalPoints, created_at: new Date('2026-10-29T19:00:00Z') });
    const grown = deriveHandoffDocument(documentInput({ attempts: [retake, graded], award: miniAwardRow('course-v1') }));
    expect(grown.marks).toHaveLength(2);
    expect(grown.marks[0]).toEqual(before.marks[0]);
    expect(grown.reporting.attempts[0]).toEqual(before.reporting.attempts[0]);
  });
});
