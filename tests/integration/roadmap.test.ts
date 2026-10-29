import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestCourseGeneration, getCourse, markItemDone } from '../../src/modules/course-generation/service';
import { runCourseGeneration } from '../../src/modules/course-generation/worker';
import { getAssessment, startTest, submitAttempt, getSwitchDisclosure, switchCourseVersion, getRoadmap } from '../../src/modules/assessment-progress/service';
import { insertParentManifest } from '../../src/modules/assessment-progress/repository';
import { bindReviewStateQuery, reviewStatePortBound } from '../../src/modules/assessment-progress/review-port';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import { REVIEW_STATE_PORT_VERSION, type AttemptSnapshot } from '../../src/contracts/assessment';
import type { Command, Identity, Plan } from '../../src/contracts/setup';

// LOCAL SYNTHETIC coverage of the epic-3 story-6 whole-mini-course roadmap
// surface: an owner-scoped READ model over real studies — node states that
// follow completion awards exactly (Completed only from an earned
// version-scoped award; a failed-group course honestly In progress with a
// Needs practice pill while a completed sibling stays Completed), the
// recommended prerequisite order from a planted parent manifest (the 3.4
// synthetic-fixture precedent), free browsing of every authorized node (no
// locks/XP anywhere in the contract), the honest "Plan confirmed — course
// not generated" state, version-superseded honesty through the REAL switch
// flow, cross-owner scope denial (structural: every read owner_id-scoped),
// and the stubbed versioned review-state port (unbound default renders no
// pill and never changes completion; the final journey binds a fake through
// the real seam exactly as epic-spaced-review will). Real PostgreSQL; the
// processor is the local synthetic fixture — zero network, zero dispatch.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

const plan: Plan = {
  topic: 'Unit testing fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const textA = 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.';
const textB = 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.';

async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({ body: { email: credentials.email, password: credentials.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>('SELECT id FROM auth.session WHERE token=$1', [body.token]);
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}

async function grant(identity: Identity) {
  const current = await database().query<{ eligibility: string; daily_admission_limit: number }>(
    'SELECT eligibility,daily_admission_limit FROM app.processor_configuration ORDER BY version DESC LIMIT 1',
  );
  if (current.rows[0]?.eligibility !== 'eligible' || current.rows[0].daily_admission_limit < 5) {
    const max = await database().query<{ max: number }>('SELECT max(version) AS max FROM app.processor_configuration');
    await database().query(
      `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
       VALUES($1,$2,'Synthetic test spy (fixture — not compliant live AI)','Boundary test purpose','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.','eligible',true,20)`,
      [crypto.randomUUID(), max.rows[0].max + 1],
    );
  }
  const disclosure = await getDisclosure(identity);
  await decide(identity, { ...command(), configurationVersion: disclosure.configuration.version, decision: 'granted', acknowledgedTerms: true });
}

async function confirmedStudy(identity: Identity, studyPlan: Plan = plan, texts: string[] = [textA, textB]) {
  const names = ['notes.txt', 'doubles.txt'];
  const slotIds = texts.map(() => crypto.randomUUID());
  const batch = await createBatch(identity, { ...command(), inputs: texts.map((text, index) => ({ slotId: slotIds[index], filename: names[index], mime: 'text/plain', byteLength: Buffer.byteLength(text) })) });
  for (const [index, text] of texts.entries()) {
    const upload = await uploadSlot(identity, batch.rootId, slotIds[index], command(), new Blob([text]).stream());
    await runExtraction(upload.operationId!);
  }
  const preview = await getBatch(identity, batch.rootId);
  const slots = preview.slots.filter(item => slotIds.includes(item.slotId));
  if (slots.length !== texts.length || slots.some(item => !item.extractionId)) throw new Error('fixture setup failed');
  await acknowledge(identity, batch.rootId, { ...command(preview.revision), selected: slots.map(item => ({ slotId: item.slotId, extractionId: item.extractionId!, acknowledged: true as const })), excluded: [] });
  const acknowledged = await getBatch(identity, batch.rootId);
  const saved = await savePlan(identity, batch.rootId, { ...command(acknowledged.revision), plan: studyPlan, extractionId: acknowledged.selection!.sources[0].extractionId, selectionId: acknowledged.selection!.id });
  await confirmPlan(identity, batch.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
  const confirmed = await getBatch(identity, batch.rootId);
  return { ...confirmed, planRevisionId: saved.planRevisionId!, extractionId: acknowledged.selection!.sources[0].extractionId, selectionId: acknowledged.selection!.id };
}

async function generateCourse(identity: Identity, rootId: string, revision: number) {
  await requestCourseGeneration(identity, rootId, { ...command(revision) });
  const row = await database().query<{ id: string; root_id: string; admission_id: string }>(
    'SELECT id,root_id,admission_id FROM app.generated_course WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at DESC LIMIT 1',
    [identity.userId, rootId],
  );
  if (!row.rows[0]) throw new Error('no course request row');
  await runCourseGeneration({ schemaVersion: 1, requestId: row.rows[0].id, admissionId: row.rows[0].admission_id, rootId: row.rows[0].root_id, ownerId: identity.userId, sessionId: identity.sessionId });
  const course = await getCourse(identity, rootId);
  if (course.state !== 'ready') throw new Error('course not ready');
  return course;
}

async function snapshotOf(rootId: string): Promise<AttemptSnapshot> {
  const row = await database().query<{ snapshot: AttemptSnapshot }>('SELECT snapshot FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1', [rootId]);
  if (!row.rows[0]) throw new Error('no attempt row');
  return row.rows[0].snapshot;
}

function answersFrom(snapshot: AttemptSnapshot, wrongPositions: number[] = []) {
  return snapshot.items.map(item => ({
    position: item.position,
    choiceId: wrongPositions.includes(item.position) ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId,
  }));
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-3 story-6: whole-mini-course roadmap surface', () => {
  it('renders a three-mini-course path whose node states follow completion awards exactly, with the failed-group course In progress + Needs practice beside a Completed sibling', async () => {
    const a = await actor('roadmap-path-a');
    await grant(a);

    // Study 1 — COMPLETED the honest way: every required item done, then a
    // passing attempt (the award lands at the passing submit).
    const study1 = await confirmedStudy(a, { ...plan, topic: 'Roadmap child one', miniCourse: { ...plan.miniCourse, title: 'Roadmap course one' } });
    const course1 = await generateCourse(a, study1.rootId, study1.revision);
    for (const item of course1.course.items.filter(item => item.required))
      await markItemDone(a, study1.rootId, { ...command(study1.revision), courseId: course1.course.courseId, itemId: item.id });
    const attempt1 = await startTest(a, study1.rootId, { ...command(study1.revision) });
    const snap1 = await snapshotOf(study1.rootId);
    await submitAttempt(a, study1.rootId, attempt1.operationId, { ...command(study1.revision), attemptId: attempt1.operationId, answers: answersFrom(snap1) });

    // Study 2 — FAILED at the honest 79.96% boundary: items done, attempt
    // failed, the failed group ledgers OPEN (Needs practice), no award.
    const study2 = await confirmedStudy(a, { ...plan, topic: 'Roadmap child two', miniCourse: { ...plan.miniCourse, title: 'Roadmap course two' } });
    const course2 = await generateCourse(a, study2.rootId, study2.revision);
    for (const item of course2.course.items.filter(item => item.required))
      await markItemDone(a, study2.rootId, { ...command(study2.revision), courseId: course2.course.courseId, itemId: item.id });
    const attempt2 = await startTest(a, study2.rootId, { ...command(study2.revision) });
    const snap2 = await snapshotOf(study2.rootId);
    await submitAttempt(a, study2.rootId, attempt2.operationId, { ...command(study2.revision), attemptId: attempt2.operationId, answers: answersFrom(snap2, [5]) });

    // Study 3 — generated, never touched: Not started.
    const study3 = await confirmedStudy(a, { ...plan, topic: 'Roadmap child three', miniCourse: { ...plan.miniCourse, title: 'Roadmap course three' } });
    const course3 = await generateCourse(a, study3.rootId, study3.revision);

    // Plant the parent manifest through the module's own writer (the 3.3
    // planted-fixture precedent), pinning an order that is deliberately NOT
    // the confirmation order: three, one, two.
    const manifestId = crypto.randomUUID();
    const client = await database().connect();
    try {
      await insertParentManifest(client, {
        id: crypto.randomUUID(), manifestId, ownerId: a.userId, rootId: study1.rootId,
        manifest: { schemaVersion: 1, children: [
          { courseId: course3.course.courseId, required: true },
          { courseId: course1.course.courseId, required: true },
          { courseId: course2.course.courseId, required: true },
        ] },
      });
    } finally { await client.release(); }

    const view = await getRoadmap(a);
    expect(view.paths).toHaveLength(1); // all three studies belong to the path
    const path = view.paths[0];
    expect(path.manifestId).toBe(manifestId);
    expect(path.completedAt).toBeNull(); // one unawarded required child blocks the parent
    // Recommended order = the manifest's pinned order, numbering only.
    expect(path.nodes.map(node => node.title)).toEqual(['Roadmap course three', 'Roadmap course one', 'Roadmap course two']);
    const [node3, node1, node2] = path.nodes;
    // States follow completion awards exactly.
    expect(node1.state).toBe('completed');
    expect(node1.needsPractice).toBe(false);
    expect(node2.state).toBe('in-progress');
    expect(node2.needsPractice).toBe(true); // open failed group, observed difficulty
    expect(node3.state).toBe('not-started');
    expect(node3.needsPractice).toBe(false);
    // Every node freely browsable: each carries its openable root, and the
    // contract carries no lock/xp/gating field anywhere (the honesty note's
    // PROSE names their absence — a JSON KEY would be `"<name>":`).
    expect(path.nodes.map(node => node.rootId)).toEqual([study3.rootId, study1.rootId, study2.rootId]);
    expect(JSON.stringify(view)).not.toMatch(/"(?:lock\w*|xp\w*|points\w*|prerequisite\w*)":/u);
    // The assessment panel and the roadmap node agree about study 2 (In
    // progress on the same award-absence) and study 1 (Completed).
    expect((await getAssessment(a, study2.rootId)).node).toBe('in-progress');
    expect((await getAssessment(a, study1.rootId)).node).toBe('completed');

    // Completing study 2 through a passing retake moves its node to
    // Completed; the PARENT path stays pending while required child 3 is
    // unawarded (optional children never block, required ones do — the 3.4
    // rule served through the roadmap read model).
    const retake = await startTest(a, study2.rootId, { ...command(study2.revision) });
    const retakeSnap = await snapshotOf(study2.rootId);
    await submitAttempt(a, study2.rootId, retake.operationId, { ...command(study2.revision), attemptId: retake.operationId, answers: answersFrom(retakeSnap) });
    let after = await getRoadmap(a);
    expect(after.paths[0].nodes.find(node => node.rootId === study2.rootId)!.state).toBe('completed');
    // The failed ledger stays OPEN (never rewritten) but the newer passing
    // attempt recovered the requirement normally — the pill suppresses.
    expect(after.paths[0].nodes.find(node => node.rootId === study2.rootId)!.needsPractice).toBe(false);
    expect(after.paths[0].completedAt).toBeNull(); // required child 3 unawarded blocks
    // Completing the LAST required child awards the parent path — the
    // path-level completion follows the awards exactly too.
    for (const item of course3.course.items.filter(item => item.required))
      await markItemDone(a, study3.rootId, { ...command(study3.revision), courseId: course3.course.courseId, itemId: item.id });
    const attempt3 = await startTest(a, study3.rootId, { ...command(study3.revision) });
    const snap3 = await snapshotOf(study3.rootId);
    await submitAttempt(a, study3.rootId, attempt3.operationId, { ...command(study3.revision), attemptId: attempt3.operationId, answers: answersFrom(snap3) });
    after = await getRoadmap(a);
    expect(after.paths[0].nodes.find(node => node.rootId === study3.rootId)!.state).toBe('completed');
    expect(after.paths[0].completedAt).not.toBeNull(); // every required child now awarded
  });

  it('renders the honest not-generated state and the unbound review port: no pill anywhere, completion unchanged', async () => {
    const a = await actor('roadmap-honest-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Ungenerated roadmap study' });
    const view = await getRoadmap(a);
    expect(view.paths).toHaveLength(1);
    const node = view.paths[0].nodes[0];
    expect(node.rootId).toBe(study.rootId);
    expect(node.courseStatus).toBe('not-generated');
    expect(node.state).toBeNull(); // no invented progress
    expect(node.courseId).toBeNull();
    expect(node.reviewDue).toBe(false); // unbound port → no pill, never a wrong state
    expect(view.reviewPortBound).toBe(false);
    expect(view.reviewUnavailableNote).toContain('Review scheduling is not part of this build');
    // The port is unbound in this process: the seam reports it honestly.
    expect(reviewStatePortBound()).toBe(false);
  });

  it('keeps version-superseded honesty through the real switch flow: the node follows the studied release, awards never erased', async () => {
    const a = await actor('roadmap-superseded-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Superseded roadmap study' });
    const v1 = await generateCourse(a, study.rootId, study.revision);
    for (const item of v1.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId: v1.course.courseId, itemId: item.id });
    const attempt = await startTest(a, study.rootId, { ...command(study.revision) });
    const snap = await snapshotOf(study.rootId);
    await submitAttempt(a, study.rootId, attempt.operationId, { ...command(study.revision), attemptId: attempt.operationId, answers: answersFrom(snap) });
    let view = await getRoadmap(a);
    let node = view.paths[0].nodes[0];
    expect(node.state).toBe('completed');
    expect(node.version).toBe(1);
    expect(node.superseded).toBe(false);

    // Regenerate: version 2 becomes the default resolution — the node
    // honestly reports v2 In progress (its own unawarded condition set)
    // while the v1 award stays earned.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...plan, topic: 'Superseded roadmap study, v2' }, extractionId: study.extractionId, selectionId: study.selectionId });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await generateCourse(a, study.rootId, confirmed.revision);
    view = await getRoadmap(a);
    node = view.paths[0].nodes[0];
    expect(node.version).toBe(2);
    expect(node.state).toBe('in-progress');
    expect(node.superseded).toBe(false); // studying the newest ready release

    // Switch BACK to version 1 through the real informed flow: the node
    // reads Completed FROM the existing v1 award and carries the honest
    // superseded note (a newer version is ready; switching is explicit).
    const disclosure = await getSwitchDisclosure(a, study.rootId, String(1));
    await switchCourseVersion(a, study.rootId, {
      ...command(disclosure.revision),
      courseId: disclosure.to.courseId,
      acknowledged: {
        addedRequiredItemIds: disclosure.addedRequiredItems.map(item => item.id),
        removedRequiredItemIds: disclosure.removedRequiredItems.map(item => item.id),
        requiredTestChanged: disclosure.requiredTestChanged,
      },
    });
    view = await getRoadmap(a);
    node = view.paths[0].nodes[0];
    expect(node.version).toBe(1);
    expect(node.state).toBe('completed'); // from the award — nothing re-earned
    expect(node.superseded).toBe(true);
    expect(node.latestVersion).toBe(2);
  });

  it('denies cross-owner reads structurally: another owner sees only their own studies', async () => {
    const a = await actor('roadmap-scope-a');
    await grant(a);
    const studyA = await confirmedStudy(a, { ...plan, topic: 'Scope owner A study' });
    const b = await actor('roadmap-scope-b');
    const viewA = await getRoadmap(a);
    expect(viewA.paths.map(path => path.nodes.map(node => node.rootId)).flat()).toContain(studyA.rootId);
    const viewB = await getRoadmap(b);
    const bRoots = viewB.paths.map(path => path.nodes.map(node => node.rootId)).flat();
    expect(bRoots).not.toContain(studyA.rootId);
    expect(bRoots).toEqual([]); // B confirmed nothing
  });

  // The port-binding journey runs LAST in this file on purpose: the seam is
  // one-way for the process's lifetime (no unbind exists — no honest surface
  // needs one), and vitest isolates files, so the fake bound here is exactly
  // the epic-spaced-review shape and never leaks into other journeys.
  it('binds a review-state query through the real seam: the pill renders pinned to the release and a due review never removes completion', async () => {
    const a = await actor('roadmap-review-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Review port study' });
    const course = await generateCourse(a, study.rootId, study.revision);
    for (const item of course.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.course.courseId, itemId: item.id });
    const attempt = await startTest(a, study.rootId, { ...command(study.revision) });
    const snap = await snapshotOf(study.rootId);
    await submitAttempt(a, study.rootId, attempt.operationId, { ...command(study.revision), attemptId: attempt.operationId, answers: answersFrom(snap) });

    let dueCourseId = '';
    bindReviewStateQuery(async input => ({ schemaVersion: REVIEW_STATE_PORT_VERSION, courseId: input.courseId, courseVersion: input.courseVersion, due: input.courseId === dueCourseId }));
    // The exact epic-4 shape: due for one release only, version-pinned.
    dueCourseId = course.course.courseId;
    const view = await getRoadmap(a);
    expect(view.reviewPortBound).toBe(true);
    expect(view.reviewUnavailableNote).toBeNull();
    const node = view.paths[0].nodes[0];
    expect(node.reviewDue).toBe(true);
    expect(node.state).toBe('completed'); // the pill NEVER feeds the state (D6)
    // A not-due answer for any other release renders no pill there.
    dueCourseId = crypto.randomUUID();
    const other = await confirmedStudy(a, { ...plan, topic: 'Review port second study' });
    await generateCourse(a, other.rootId, other.revision);
    const after = await getRoadmap(a);
    for (const path of after.paths)
      for (const candidate of path.nodes)
        if (candidate.rootId === other.rootId) expect(candidate.reviewDue).toBe(false);
  });
});
