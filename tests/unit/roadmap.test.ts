import { describe, expect, it } from 'vitest';
import { ROADMAP_HONESTY_NOTE, REVIEW_STATE_PORT_VERSION, type ReviewDueState } from '../../src/contracts/assessment';
import { buildSnapshot } from '../../src/modules/assessment-progress/bank';
import { REVIEW_UNAVAILABLE_NOTE, deriveRoadmapView, type RoadmapCourseFact, type RoadmapInput, type RoadmapRootFact } from '../../src/modules/assessment-progress/roadmap';
import type { AttemptRow, AwardRow, RecoveryTargetRow } from '../../src/modules/assessment-progress/repository';

// Unit coverage of the epic-3 story-6 pure roadmap derivation: node states
// following completion awards exactly (Completed only from an earned
// version-scoped award pinning the resolved release — the story-4 rule),
// the Needs-practice pill mirroring guidance's chain rule at node altitude,
// the review pill fed only by the versioned review-state port (unbound → no
// pill, never a wrong state, and structurally never an input to node state),
// recommended order from the plan machinery (manifest pinned order +
// confirmation order for standalone studies), and the honest
// not-generated/pending/failed/superseded states — free browsing with no
// locks and no XP is structural (the contract carries no such fields).

const objectives = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ index, text: `Synthetic objective ${index + 1}` }));

const snapshot = buildSnapshot(objectives(2));

// A minimal graded/active attempt row (the derivation reads root_id,
// course_id, status, passed, created_at, id and the ledger join).
function attemptRow(over: Partial<AttemptRow> & Pick<AttemptRow, 'id' | 'root_id' | 'course_id'>): AttemptRow {
  return {
    owner_id: 'owner',
    course_version: 1,
    plan_revision_id: 'plan-1',
    status: 'graded',
    snapshot,
    answers: [],
    earned_points: 0,
    total_points: snapshot.totalPoints,
    passed: false,
    created_at: new Date('2026-10-29T10:00:00Z'),
    graded_at: new Date('2026-10-29T10:01:00Z'),
    ...over,
  };
}

function targetRow(rootAttemptId: string, courseId: string, status: 'open' | 'cleared'): RecoveryTargetRow {
  return {
    id: `target-${rootAttemptId}-${courseId}-${status}`,
    root_attempt_id: rootAttemptId,
    owner_id: 'owner',
    root_id: 'root-failed',
    course_id: courseId,
    course_version: 1,
    objective_index: 0,
    objective: 'Synthetic objective 1',
    initial_earned: 0,
    initial_total: 10000,
    status,
    cleared_by: status === 'cleared' ? 'retest-1' : null,
    cleared_at: status === 'cleared' ? new Date('2026-10-29T11:00:00Z') : null,
    created_at: new Date('2026-10-29T10:01:00Z'),
  };
}

const root = (rootId: string, at: string, title = `Course of ${rootId}`): RoadmapRootFact => ({ rootId, confirmedAt: new Date(at), title, topic: `Topic of ${rootId}` });
const readyCourse = (rootId: string, courseId: string, over: Partial<RoadmapCourseFact> = {}): RoadmapCourseFact => ({ rootId, courseId, version: 1, status: 'ready', requiredTotal: 2, requiredDone: 0, ...over });

function inputOf(over: Partial<RoadmapInput> = {}): RoadmapInput {
  return {
    roots: [],
    resolved: new Map(),
    latestReadyVersions: new Map(),
    awardedCourseIds: [],
    attempts: [],
    targets: [],
    manifests: [],
    courseRoots: new Map(),
    reviewStates: new Map(),
    reviewPortBound: false,
    ...over,
  };
}

function manifestRow(manifestId: string, children: Array<{ courseId: string; required: boolean }>, awarded = false): AwardRow {
  return {
    id: `row-${manifestId}`,
    owner_id: 'owner',
    root_id: 'root-a',
    kind: 'parent-path',
    course_id: null,
    course_version: null,
    plan_revision_id: null,
    manifest_id: manifestId,
    manifest: { schemaVersion: 1, children },
    awarded_at: awarded ? new Date('2026-10-29T12:00:00Z') : null,
    created_at: new Date('2026-10-29T09:00:00Z'),
  };
}

describe('story-6 roadmap derivation: node states follow awards exactly', () => {
  it('renders Completed only from an earned award pinning the resolved release; engagement reads In progress; untouched reads Not started', () => {
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z'), root('root-b', '2026-10-29T09:01:00Z'), root('root-c', '2026-10-29T09:02:00Z')],
      resolved: new Map([
        ['root-a', readyCourse('root-a', 'course-a', { requiredDone: 2 })],
        ['root-b', readyCourse('root-b', 'course-b', { requiredDone: 1 })],
        ['root-c', readyCourse('root-c', 'course-c')],
      ]),
      awardedCourseIds: ['course-a'],
      attempts: [attemptRow({ id: 'attempt-a', root_id: 'root-a', course_id: 'course-a', passed: true }), attemptRow({ id: 'attempt-b', root_id: 'root-b', course_id: 'course-b' })],
    }));
    const states = view.paths.map(path => path.nodes[0].state);
    expect(states).toEqual(['completed', 'in-progress', 'not-started']);
    expect(view.paths.map(path => path.manifestId)).toEqual([null, null, null]); // standalone paths
  });

  it('keeps a passed-but-unawarded release honestly In progress (the pre-award window)', () => {
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z')],
      resolved: new Map([['root-a', readyCourse('root-a', 'course-a', { requiredDone: 2 })]]),
      attempts: [attemptRow({ id: 'attempt-a', root_id: 'root-a', course_id: 'course-a', passed: true })],
    }));
    expect(view.paths[0].nodes[0].state).toBe('in-progress');
  });

  it('orders standalone studies by plan confirmation time (the plan-declared sequence), oldest first', () => {
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-late', '2026-10-29T15:00:00Z'), root('root-early', '2026-10-29T08:00:00Z'), root('root-mid', '2026-10-29T11:00:00Z')],
      resolved: new Map([['root-late', readyCourse('root-late', 'c3')], ['root-early', readyCourse('root-early', 'c1')], ['root-mid', readyCourse('root-mid', 'c2')]]),
    }));
    expect(view.paths.map(path => path.nodes[0].rootId)).toEqual(['root-early', 'root-mid', 'root-late']);
  });
});

describe('story-6 roadmap derivation: the Needs practice pill', () => {
  it('marks a failed-group course In progress with a Needs practice pill while a completed sibling stays Completed without one', () => {
    const failedAttempt = attemptRow({ id: 'attempt-f', root_id: 'root-failed', course_id: 'course-f' });
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-failed', '2026-10-29T09:00:00Z'), root('root-done', '2026-10-29T09:05:00Z')],
      resolved: new Map([['root-failed', readyCourse('root-failed', 'course-f', { requiredDone: 2 })], ['root-done', readyCourse('root-done', 'course-done', { requiredDone: 2 })]]),
      awardedCourseIds: ['course-done'],
      attempts: [failedAttempt, attemptRow({ id: 'attempt-done', root_id: 'root-done', course_id: 'course-done', passed: true })],
      targets: [targetRow('attempt-f', 'course-f', 'open')],
    }));
    const failed = view.paths.find(path => path.nodes[0].rootId === 'root-failed')!.nodes[0];
    const done = view.paths.find(path => path.nodes[0].rootId === 'root-done')!.nodes[0];
    expect(failed.state).toBe('in-progress');
    expect(failed.needsPractice).toBe(true);
    expect(done.state).toBe('completed');
    expect(done.needsPractice).toBe(false);
  });

  it('suppresses the pill when a newer passing attempt on the same release recovered the requirement normally', () => {
    const failedOlder = attemptRow({ id: 'attempt-f', root_id: 'root-a', course_id: 'course-a', created_at: new Date('2026-10-29T10:00:00Z') });
    const passedNewer = attemptRow({ id: 'attempt-p', root_id: 'root-a', course_id: 'course-a', passed: true, created_at: new Date('2026-10-29T11:00:00Z') });
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z')],
      resolved: new Map([['root-a', readyCourse('root-a', 'course-a', { requiredDone: 2 })]]),
      attempts: [passedNewer, failedOlder], // newest first, the served order
      targets: [targetRow('attempt-f', 'course-a', 'open')], // ledger stays open — nothing is rewritten
    }));
    expect(view.paths[0].nodes[0].needsPractice).toBe(false);
    expect(view.paths[0].nodes[0].state).toBe('in-progress'); // passed but unawarded stays honest
  });

  it('drops the pill once every ledgered group is cleared (full recovery)', () => {
    const failed = attemptRow({ id: 'attempt-f', root_id: 'root-a', course_id: 'course-a' });
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z')],
      resolved: new Map([['root-a', readyCourse('root-a', 'course-a', { requiredDone: 2 })]]),
      attempts: [failed],
      targets: [targetRow('attempt-f', 'course-a', 'cleared')],
    }));
    expect(view.paths[0].nodes[0].needsPractice).toBe(false);
  });

  it('scopes the pill to the resolved release: a failed chain on another release never marks this node', () => {
    const failedElsewhere = attemptRow({ id: 'attempt-x', root_id: 'root-a', course_id: 'course-old' });
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z')],
      resolved: new Map([['root-a', readyCourse('root-a', 'course-new')]]),
      attempts: [failedElsewhere],
      targets: [targetRow('attempt-x', 'course-old', 'open')],
    }));
    expect(view.paths[0].nodes[0].needsPractice).toBe(false);
  });
});

describe('story-6 roadmap derivation: the versioned review-state port', () => {
  const completedNode = (viewStates: { reviewStates: Map<string, ReviewDueState>; bound: boolean }) =>
    deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z')],
      resolved: new Map([['root-a', readyCourse('root-a', 'course-a', { requiredDone: 2 })]]),
      awardedCourseIds: ['course-a'],
      attempts: [attemptRow({ id: 'attempt-a', root_id: 'root-a', course_id: 'course-a', passed: true })],
      reviewStates: viewStates.reviewStates,
      reviewPortBound: viewStates.bound,
    })).paths[0].nodes[0];

  it('renders no pill and the honest unavailable note with the port unbound', () => {
    const node = completedNode({ reviewStates: new Map(), bound: false });
    expect(node.reviewDue).toBe(false);
    expect(node.state).toBe('completed');
  });
  it('renders the pill for an exactly-pinned due review while completion stays Completed', () => {
    const due: ReviewDueState = { schemaVersion: REVIEW_STATE_PORT_VERSION, courseId: 'course-a', courseVersion: 1, due: true };
    const node = completedNode({ reviewStates: new Map([['course-a', due]]), bound: true });
    expect(node.reviewDue).toBe(true);
    expect(node.state).toBe('completed'); // a due review can never remove completion
  });
  it('ignores a due state pinned to a different release or version, and a not-due state (never a wrong state)', () => {
    const other: ReviewDueState = { schemaVersion: REVIEW_STATE_PORT_VERSION, courseId: 'course-b', courseVersion: 1, due: true };
    const wrongVersion: ReviewDueState = { schemaVersion: REVIEW_STATE_PORT_VERSION, courseId: 'course-a', courseVersion: 2, due: true };
    const notDue: ReviewDueState = { schemaVersion: REVIEW_STATE_PORT_VERSION, courseId: 'course-a', courseVersion: 1, due: false };
    for (const state of [other, wrongVersion, notDue]) {
      const node = completedNode({ reviewStates: new Map([['course-a', state]]), bound: true });
      expect(node.reviewDue).toBe(false);
    }
  });
  it('ignores a due state carrying an unexpected port schema version (review disposition 2026-10-29 — the version check is load-bearing)', () => {
    // The contract type pins schemaVersion to the current port version; only
    // a future binding can produce a different value, so this case must
    // bypass the type to prove the derivation still refuses it.
    const futureState = { schemaVersion: REVIEW_STATE_PORT_VERSION + 1, courseId: 'course-a', courseVersion: 1, due: true } as unknown as ReviewDueState;
    const node = completedNode({ reviewStates: new Map([['course-a', futureState]]), bound: true });
    expect(node.reviewDue).toBe(false);
    expect(node.state).toBe('completed');
  });
});

describe('story-6 roadmap derivation: recommended order and honesty states', () => {
  it('renders a parent manifest as one path in its pinned child order, mapping each release to its study', () => {
    const roots = [root('root-1', '2026-10-29T09:00:00Z'), root('root-2', '2026-10-29T09:01:00Z'), root('root-3', '2026-10-29T09:02:00Z')];
    const view = deriveRoadmapView(inputOf({
      roots,
      resolved: new Map([['root-1', readyCourse('root-1', 'c1')], ['root-2', readyCourse('root-2', 'c2')], ['root-3', readyCourse('root-3', 'c3')]]),
      // Pinned order deliberately NOT the confirmation order: 3, 1, 2.
      manifests: [manifestRow('m1', [{ courseId: 'c3', required: true }, { courseId: 'c1', required: true }, { courseId: 'c2', required: false }])],
      courseRoots: new Map([['c1', 'root-1'], ['c2', 'root-2'], ['c3', 'root-3']]),
    }));
    expect(view.paths).toHaveLength(1);
    expect(view.paths[0].manifestId).toBe('m1');
    expect(view.paths[0].nodes.map(node => node.rootId)).toEqual(['root-3', 'root-1', 'root-2']);
    expect(view.paths[0].completedAt).toBeNull(); // pending manifest
  });

  it('renders a root in every manifest that pins it and carries the parent award when earned', () => {
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-1', '2026-10-29T09:00:00Z'), root('root-2', '2026-10-29T09:01:00Z')],
      resolved: new Map([['root-1', readyCourse('root-1', 'c1')], ['root-2', readyCourse('root-2', 'c2')]]),
      manifests: [manifestRow('m1', [{ courseId: 'c1', required: true }, { courseId: 'c2', required: true }], true), manifestRow('m2', [{ courseId: 'c1', required: true }])],
      courseRoots: new Map([['c1', 'root-1'], ['c2', 'root-2']]),
    }));
    expect(view.paths.map(path => path.manifestId)).toEqual(['m1', 'm2']);
    expect(view.paths[0].completedAt).not.toBeNull();
    expect(view.paths[1].completedAt).toBeNull();
    expect(view.paths[0].nodes.map(node => node.rootId)).toEqual(['root-1', 'root-2']);
  });

  it('renders the honest not-generated, pending and failed states with NO progress state claimed', () => {
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-none', '2026-10-29T09:00:00Z'), root('root-pending', '2026-10-29T09:01:00Z'), root('root-failed', '2026-10-29T09:02:00Z')],
      resolved: new Map([
        ['root-none', null],
        ['root-pending', { rootId: 'root-pending', courseId: 'c-pending', version: null, status: 'pending', requiredTotal: 0, requiredDone: 0 }],
        ['root-failed', { rootId: 'root-failed', courseId: 'c-failed', version: null, status: 'failed', requiredTotal: 0, requiredDone: 0 }],
      ]),
      // Even an award elsewhere cannot invent progress on ungenerated studies.
      awardedCourseIds: ['c-pending'],
    }));
    expect(view.paths.map(path => path.nodes[0].courseStatus)).toEqual(['not-generated', 'pending', 'failed']);
    expect(view.paths.every(path => path.nodes[0].state === null)).toBe(true);
    expect(view.paths.every(path => path.nodes[0].courseId === null || path.nodes[0].courseStatus !== 'ready')).toBe(true);
  });

  it('marks the studied release superseded when a newer ready version exists, keeping the studied state', () => {
    const view = deriveRoadmapView(inputOf({
      roots: [root('root-a', '2026-10-29T09:00:00Z')],
      resolved: new Map([['root-a', readyCourse('root-a', 'course-v1', { version: 1, requiredDone: 2 })]]),
      latestReadyVersions: new Map([['root-a', 2]]),
      awardedCourseIds: ['course-v1'],
      attempts: [attemptRow({ id: 'a1', root_id: 'root-a', course_id: 'course-v1', passed: true })],
    }));
    const node = view.paths[0].nodes[0];
    expect(node.state).toBe('completed');
    expect(node.superseded).toBe(true);
    expect(node.latestVersion).toBe(2);
    expect(node.version).toBe(1);
  });

  it('serves the fixed honesty note and the honest unavailable note exactly while unbound', () => {
    const unbound = deriveRoadmapView(inputOf());
    expect(unbound.note).toBe(ROADMAP_HONESTY_NOTE);
    expect(unbound.reviewPortBound).toBe(false);
    expect(unbound.reviewUnavailableNote).toBe(REVIEW_UNAVAILABLE_NOTE);
    const bound = deriveRoadmapView(inputOf({ reviewPortBound: true }));
    expect(bound.reviewUnavailableNote).toBeNull();
  });

  it('renders an empty roadmap honestly when no confirmed studies exist', () => {
    const view = deriveRoadmapView(inputOf());
    expect(view.paths).toEqual([]);
  });
});
