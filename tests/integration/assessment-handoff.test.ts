import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestCourseGeneration, getCourse, markItemDone } from '../../src/modules/course-generation/service';
import { runCourseGeneration } from '../../src/modules/course-generation/worker';
import { getAssessment, startTest, submitAttempt, flagAssessmentItem, getAssessmentHandoff } from '../../src/modules/assessment-progress/service';
import { insertParentManifest } from '../../src/modules/assessment-progress/repository';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AttemptSnapshot } from '../../src/contracts/assessment';
import type { AssessmentHandoffState } from '../../src/contracts/assessment';

// LOCAL SYNTHETIC coverage of the epic-3 story-8 versioned completion and
// evidence handoff surface — the ticket's verify scenarios through the REAL
// verbs, with this file acting as the synthetic downstream consumer:
// awards, applicable pass-mark snapshots and the AD-13 shared evaluator
// verdict resolved PINNED to exact revisions; supersession leaving pinned
// reads value-identical while new default reads see the new release; the
// verdict computable with ZERO scheduling surface; and the denial sweep
// (out-of-scope fields= names, cross-owner root/release reads). Real
// PostgreSQL; the processor is the local synthetic fixture — zero network,
// and the handoff surface dispatches nothing (it is a read model).
//
// AUTHORED-PENDING-EXECUTION (this phase): the shared DB cluster is reserved
// for the serialized full gate the orchestrator runs; this suite executes
// after that merge. The pure halves of every scenario are unit-covered in
// tests/unit/assessment-handoff.test.ts to de-risk the run.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

const plan: Plan = {
  topic: 'Versioned handoff fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain pinned reads', 'Explain supersession stability', 'Explain scope denial'],
  miniCourse: { title: 'Handoff basics', lessons: ['What a pinned release is'], practice: 'Name one pinned fact', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover downstream epics.',
};
const textA = 'A pinned read resolves one exact release. Supersession adds a new release without touching pinned facts.';
const textB = 'Scope declarations name contract fields only. Another owner reads nothing of yours.';

async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({ body: { email: credentials.email, password: credentials.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>('SELECT id FROM auth.session WHERE token=$1', [body.token]);
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}

// The processor_configuration table is shared, ordered state (the ai-check
// note): grant against the current version only when it is eligible WITH a
// usable daily quota — sibling suites may leave their own fixtures current.
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

async function snapshotOf(attemptId: string): Promise<AttemptSnapshot> {
  const row = await database().query<{ snapshot: AttemptSnapshot }>('SELECT snapshot FROM app.test_attempt WHERE id=$1', [attemptId]);
  if (!row.rows[0]) throw new Error('no attempt row');
  return row.rows[0].snapshot;
}

function answersFrom(snapshot: AttemptSnapshot, wrongPositions: number[] = []) {
  return snapshot.items.map(item => ({
    position: item.position,
    choiceId: wrongPositions.includes(item.position) ? snapshot.items[0]!.choices.find(choice => choice.id !== snapshot.items[0]!.answerId)!.id : item.answerId,
  })).map((answer, index) => ({ ...answer, choiceId: wrongPositions.includes(index + 1) ? '' : answer.choiceId })).length === 0 ? [] : snapshot.items.map(item => ({
    position: item.position,
    choiceId: wrongPositions.includes(item.position) ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId,
  }));
}

// The full honest completion of one release: required items done through
// the epic-2 tracker verb, one boundary failure ledgers recovery (so the
// marks/reporting projections carry real history), then a passing retake.
async function completeRelease(identity: Identity, rootId: string, revision: number, courseId: string, requiredItemIds: string[]) {
  for (const itemId of requiredItemIds)
    await markItemDone(identity, rootId, { ...command(revision), courseId, itemId });
  const failed = await startTest(identity, rootId, { ...command(revision) });
  const failedSnapshot = await snapshotOf(failed.operationId);
  await submitAttempt(identity, rootId, failed.operationId, { ...command(revision), attemptId: failed.operationId, answers: answersFrom(failedSnapshot, [5]) });
  const passed = await startTest(identity, rootId, { ...command(revision) });
  const passedSnapshot = await snapshotOf(passed.operationId);
  const graded = await submitAttempt(identity, rootId, passed.operationId, { ...command(revision), attemptId: passed.operationId, answers: answersFrom(passedSnapshot) });
  if (!graded.passed) throw new Error('fixture setup failed: expected the retake to pass');
  return { failedAttemptId: failed.operationId, passedAttemptId: passed.operationId };
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-3 story-8: versioned completion and evidence handoff surface', () => {
  it('resolves awards, applicable marks and the evaluator verdict pinned to the exact release revision', async () => {
    const a = await actor('handoff-pinned-a');
    await grant(a);
    const study = await confirmedStudy(a);
    const course = await generateCourse(a, study.rootId, study.revision);
    const courseId = course.course.courseId;
    const requiredItemIds = course.course.items.filter(item => item.required).map(item => item.id);
    const { failedAttemptId, passedAttemptId } = await completeRelease(a, study.rootId, study.revision, courseId, requiredItemIds);
    expect((await getAssessment(a, study.rootId)).currentAward).not.toBeNull();

    // Plant a parent manifest pinning this release as its single required
    // child (the module's own writer, the 3.3 planted-fixture precedent);
    // a duplicate mark re-runs the parent evaluation so the parent awards.
    const manifestId = crypto.randomUUID();
    const client = await database().connect();
    try {
      await insertParentManifest(client, { id: crypto.randomUUID(), manifestId, ownerId: a.userId, rootId: study.rootId, manifest: { schemaVersion: 1, children: [{ courseId, required: true }] } });
    } finally {
      await client.release();
    }
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId, itemId: requiredItemIds[0]! });

    // The DEFAULT read resolves the studied release; the PINNED read (by
    // course id) resolves the same exact release — one document, one truth.
    const byDefault = await getAssessmentHandoff(a, study.rootId);
    const pinned = await getAssessmentHandoff(a, study.rootId, courseId);
    if (byDefault.state !== 'ready' || pinned.state !== 'ready') throw new Error('expected ready handoff documents');
    expect(pinned.handoff).toEqual((byDefault as Extract<typeof byDefault, { state: 'ready' }>).handoff);
    const document = pinned.handoff;

    // The release pin is exact: course id, version and plan revision.
    expect(document.release).toEqual({ courseId, version: 1, planRevisionId: study.planRevisionId });
    // Applicable pass-mark snapshots: one per attempt of the release, the
    // 80% default contract carried on each (immutable rows, oldest first).
    expect(document.marks.map(mark => mark.attemptId)).toEqual([failedAttemptId, passedAttemptId]);
    for (const mark of document.marks) expect(mark).toMatchObject({ status: 'graded', passMarkPercent: 80, pointsScale: 1 });
    // Awards: the monotonic mini-course row read-only plus the parent pin.
    expect(document.awards.miniCourse).toMatchObject({ kind: 'mini-course', courseId, courseVersion: 1 });
    expect(document.awards.miniCourse!.awardedAt).not.toBeNull();
    expect(document.awards.parents).toEqual([{ manifestId, required: true, awardedAt: expect.any(String) }]);
    expect(document.awards.parents[0]!.awardedAt).not.toBeNull();
    // The AD-13 evaluator verdict: demonstrated on the clean final pass,
    // under the pinned snapshot policy, with the award served read-only.
    expect(document.evaluatorVerdict).toMatchObject({
      schemaVersion: 1,
      courseId,
      courseVersion: 1,
      assistance: 'unaided',
      outcome: 'demonstrated',
      basis: { kind: 'final-pass', attemptId: passedAttemptId },
      pausedByOpenDispute: false,
    });
    expect(document.evaluatorVerdict.policy).toMatchObject({ passMarkPercent: 80, passMarkOverride: { source: 'default', value: 80 } });
    expect(document.evaluatorVerdict.awardAwardedAt).toBe(document.awards.miniCourse!.awardedAt);
    // Reporting: the failed attempt listed honestly (final grade, not
    // passed), zero provisional grades, the ledgered chain visible.
    expect(document.reporting.provisionalGrades).toBe(0);
    expect(document.reporting.attempts.map(projection => [projection.attemptId, projection.gradeKind, projection.passed])).toEqual([
      [failedAttemptId, 'final', false],
      [passedAttemptId, 'final', true],
    ]);
    expect(document.reporting.recovery).toMatchObject({ rootAttemptId: failedAttemptId, requirementSatisfied: false });
    // The epic-6 activity/rubric/completion shape: tracker links + the
    // required-test rubric contract; no answer key anywhere.
    const testLink = document.activities.find(activity => activity.role === 'required-test');
    expect(testLink).toMatchObject({ activityId: 'required-test-1', schemaVersion: 1 });
    expect(testLink!.rubric).toMatchObject({ passMarkPercent: 80, pointsScale: 1, totalPoints: 10000 });
    expect(document.activities.filter(activity => activity.role === 'required-item').map(activity => activity.activityId).sort()).toEqual([...requiredItemIds].sort());
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('answerId');
    expect(serialized).not.toContain('correctChoiceId');
  });

  it('keeps pinned reads value-identical across a superseding release while new default reads see it', async () => {
    const a = await actor('handoff-supersession-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Superseded handoff study' });
    const v1 = await generateCourse(a, study.rootId, study.revision);
    const requiredItemIds = v1.course.items.filter(item => item.required).map(item => item.id);
    await completeRelease(a, study.rootId, study.revision, v1.course.courseId, requiredItemIds);
    const pinnedBefore = await getAssessmentHandoff(a, study.rootId, v1.course.courseId);
    if (pinnedBefore.state !== 'ready') throw new Error('expected a ready pinned document');
    const byVersionBefore = await getAssessmentHandoff(a, study.rootId, '1');
    expect(byVersionBefore).toEqual(pinnedBefore);

    // Supersede: re-confirm a changed plan and regenerate — version 2 is the
    // new default resolution; version 1's pinned facts are untouched.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...plan, topic: 'Superseded handoff study, v2' }, extractionId: study.extractionId, selectionId: study.selectionId });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    const v2 = await generateCourse(a, study.rootId, confirmed.revision);
    expect(v2.course.version).toBe(2);

    const pinnedAfter = await getAssessmentHandoff(a, study.rootId, v1.course.courseId);
    expect(pinnedAfter).toEqual(pinnedBefore); // value-identical across supersession
    const freshDefault = await getAssessmentHandoff(a, study.rootId);
    if (freshDefault.state !== 'ready') throw new Error('expected a ready default document');
    expect(freshDefault.handoff.release.courseId).toBe(v2.course.courseId); // the new read sees it
    expect(freshDefault.handoff.release.version).toBe(2);
    expect(freshDefault.handoff.marks).toEqual([]); // no attempts pinned to v2 yet
    expect(freshDefault.handoff.evaluatorVerdict).toMatchObject({ courseId: v2.course.courseId, courseVersion: 2, outcome: 'not-demonstrated', basis: null });
    expect(freshDefault.handoff.awards.miniCourse).toBeNull(); // v2 unearned; the v1 award stays on v1
    // The v1 award row survives supersession and stays readable on the pin.
    const stillPinned = await getAssessmentHandoff(a, study.rootId, v1.course.courseId);
    if (stillPinned.state !== 'ready') throw new Error('expected a ready pinned document');
    expect(stillPinned.handoff.awards.miniCourse).toMatchObject({ courseId: v1.course.courseId });
    expect(stillPinned.handoff.evaluatorVerdict.outcome).toBe('demonstrated');
  });

  it('computes the evaluator verdict with zero scheduling surface, honestly pausing on an open dispute and escaping on a clean pass', async () => {
    const a = await actor('handoff-verdict-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Verdict scheduling-free study' });
    const course = await generateCourse(a, study.rootId, study.revision);
    const courseId = course.course.courseId;
    for (const item of course.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId, itemId: item.id });

    // Before any attempt: honestly not-demonstrated under the published
    // policy, and the document carries NO scheduling field of any kind.
    const unattempted = await getAssessmentHandoff(a, study.rootId);
    if (unattempted.state !== 'ready') throw new Error('expected a ready document');
    expect(unattempted.handoff.evaluatorVerdict).toMatchObject({ outcome: 'not-demonstrated', basis: null, pausedByOpenDispute: false, awardAwardedAt: null });
    const serialized = JSON.stringify(unattempted);
    for (const absent of ['schedule', 'scheduling', 'due', 'reminder', 'notif', 'interval']) expect(serialized).not.toContain(absent);

    // The honest 79.96% boundary failure ledgers recovery; flagging the
    // deciding item opens the dispute — the pending verdict pauses.
    const failed = await startTest(a, study.rootId, { ...command(study.revision) });
    const failedSnapshot = await snapshotOf(failed.operationId);
    await submitAttempt(a, study.rootId, failed.operationId, { ...command(study.revision), attemptId: failed.operationId, answers: failedSnapshot.items.map(item => ({ position: item.position, choiceId: item.position === 5 ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId })) });
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: failed.operationId, position: 5 });
    const paused = await getAssessmentHandoff(a, study.rootId);
    if (paused.state !== 'ready') throw new Error('expected a ready document');
    expect(paused.handoff.evaluatorVerdict).toMatchObject({ outcome: 'not-demonstrated', basis: null, pausedByOpenDispute: true });
    expect(paused.handoff.reporting.recovery).toMatchObject({ rootAttemptId: failed.operationId, requirementSatisfied: false });

    // A clean newer passing attempt escapes the pause (the 3.7 rule) — the
    // verdict demonstrates on it, and the disputed 79.96% row stays listed.
    const passed = await startTest(a, study.rootId, { ...command(study.revision) });
    const passedSnapshot = await snapshotOf(passed.operationId);
    await submitAttempt(a, study.rootId, passed.operationId, { ...command(study.revision), attemptId: passed.operationId, answers: passedSnapshot.items.map(item => ({ position: item.position, choiceId: item.answerId })) });
    const recovered = await getAssessmentHandoff(a, study.rootId);
    if (recovered.state !== 'ready') throw new Error('expected a ready document');
    expect(recovered.handoff.evaluatorVerdict).toMatchObject({ outcome: 'demonstrated', basis: { kind: 'final-pass', attemptId: passed.operationId }, pausedByOpenDispute: false });
    expect(recovered.handoff.marks).toHaveLength(2); // history immutable, appended only
    expect(recovered.handoff.marks[0]!.attemptId).toBe(failed.operationId);
  });

  it('denies out-of-scope field declarations before anything is read, and never filters the document', async () => {
    const a = await actor('handoff-scope-fields-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Fields scope study' });
    await generateCourse(a, study.rootId, study.revision);
    // Out-of-scope and invented names — including scheduling/answers/roster
    // — are refused before a single row is read (the provenance fence).
    for (const fields of ['answers', 'scheduling', 'roster', 'attempts', 'due', 'awards,answers', 'answers,awards', 'awards,,marks', '']) {
      await expect(getAssessmentHandoff(a, study.rootId, undefined, fields)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    // A valid declaration serves the FULL document unchanged (the parameter
    // checks scope, it never projects or filters).
    const declared = await getAssessmentHandoff(a, study.rootId, undefined, 'awards,evaluator-verdict');
    const full = await getAssessmentHandoff(a, study.rootId, undefined, undefined);
    expect(declared).toEqual(full as AssessmentHandoffState & { objectIds: string[] });
    // A malformed course selector is likewise invalid before any read.
    await expect(getAssessmentHandoff(a, study.rootId, 'not-a-uuid-or-version')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('denies cross-owner reads: another owner sees nothing of this study or its releases', async () => {
    const a = await actor('handoff-scope-a');
    await grant(a);
    const study = await confirmedStudy(a, { ...plan, topic: 'Cross-owner handoff study' });
    const course = await generateCourse(a, study.rootId, study.revision);
    const b = await actor('handoff-scope-b');
    await grant(b);
    // B reading A's root: the scopedRoot fence denies with no leak.
    await expect(getAssessmentHandoff(b, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // A pinning a course id that is not A's own release (B never made one;
    // the same denial covers a foreign id of any owner): ready-release
    // reads are owner-scoped, so a foreign pin reads as absent.
    const foreign = await database().query<{ id: string }>('SELECT id FROM app.generated_course WHERE owner_id=$1 LIMIT 1', [b.userId]);
    if (foreign.rows[0]) await expect(getAssessmentHandoff(a, study.rootId, foreign.rows[0].id)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // An unknown version of A's own root is the same no-leak denial.
    await expect(getAssessmentHandoff(a, study.rootId, '99')).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect(course.course.version).toBe(1);
  });
});
