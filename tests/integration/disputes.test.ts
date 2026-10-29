import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestCourseGeneration, getCourse, markItemDone } from '../../src/modules/course-generation/service';
import { runCourseGeneration } from '../../src/modules/course-generation/worker';
import { getAssessment, startTest, submitAttempt, startRetest, submitRetest, flagAssessmentItem, startReplacement, submitReplacement } from '../../src/modules/assessment-progress/service';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AttemptSnapshot, ReplacementSnapshot, RetestSnapshot } from '../../src/contracts/assessment';

// LOCAL SYNTHETIC coverage of epic-3 story 7 (disputed-item correction and
// honest retries) — the ticket's five verify scenarios through the REAL
// verbs: flagging the borderline fixture item marks it Under review and
// pauses exactly the affected pending completion; the corrected replacement
// satisfies the requirement without an extra failed attempt; a previously
// earned pass and award survive flagging untouched; exhausting the daily
// generation quota yields an honest delay with zero attempt records; and
// unlimited pedagogical retries hold across the whole chain.
//
// NOTE (2026-10-29): AUTHORED, NOT EXECUTED in this lane phase — the shared
// DB cluster is reserved for the sibling 3.6 lane; the orchestrator merges
// that lane into this branch, runs migrations (025 + 026) and executes this
// suite. The pure halves of every scenario are unit-covered in
// tests/unit/assessment-disputes.test.ts to de-risk that run. Real
// PostgreSQL; the processor is the local synthetic fixture — zero network,
// and the assessment/dispute machinery dispatches nothing.

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

// The processor_configuration table is shared, ordered state (the ai-check
// note): grant against the current version only when it is eligible WITH a
// usable daily quota; otherwise pin this file's own clearly-labeled eligible
// fixture above it.
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

async function retestSnapshotOf(retestId: string): Promise<RetestSnapshot> {
  const row = await database().query<{ snapshot: RetestSnapshot }>('SELECT snapshot FROM app.retest_attempt WHERE id=$1', [retestId]);
  if (!row.rows[0]) throw new Error('no retest row');
  return row.rows[0].snapshot;
}

// The stored answer key of one corrected replacement — server-side truth
// only, like the attempt/retest readers above.
async function replacementSnapshotOf(replacementId: string): Promise<ReplacementSnapshot> {
  const row = await database().query<{ snapshot: ReplacementSnapshot }>('SELECT snapshot FROM app.assessment_replacement WHERE id=$1', [replacementId]);
  if (!row.rows[0]) throw new Error('no replacement row');
  return row.rows[0].snapshot;
}

// Answers built from a stored snapshot: wrong on the given positions,
// correct everywhere else.
function answersFrom(snapshot: AttemptSnapshot | RetestSnapshot | ReplacementSnapshot, wrongPositions: number[] = []) {
  return snapshot.items.map(item => ({
    position: item.position,
    choiceId: wrongPositions.includes(item.position) ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId,
  }));
}

// One owner's full study fixture: consented, confirmed, generated and with
// every required tracker item marked done — so the mini-course completion
// decision is pending on the required test alone.
async function readyStudyWithRequiredDone(label: string) {
  const identity = await actor(label);
  await grant(identity);
  const study = await confirmedStudy(identity);
  const course = await generateCourse(identity, study.rootId, study.revision);
  for (const item of course.course.items.filter(item => item.required))
    await markItemDone(identity, study.rootId, { ...command(study.revision), courseId: course.course.courseId, itemId: item.id });
  return { identity, study, course };
}

// The honest 79.96% boundary failure (correct on items 1-4, wrong on the
// 2004-point fifth) — the borderline fixture the ticket names.
async function failAtBoundary(identity: Identity, rootId: string, revision: number) {
  const started = await startTest(identity, rootId, { ...command(revision) });
  const snapshot = await snapshotOf(started.operationId);
  const graded = await submitAttempt(identity, rootId, started.operationId, { ...command(revision), attemptId: started.operationId, answers: answersFrom(snapshot, [5]) });
  expect(graded.passed).toBe(false);
  expect(graded.displayPercent).toBe('79.96%');
  return { attemptId: started.operationId, graded, snapshot };
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-3 story-7: disputed-item correction and honest retries', () => {
  it('flagging the borderline item marks it Under review and pauses only the affected pending completion', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('dispute-pause');
    const { attemptId, graded } = await failAtBoundary(a, study.rootId, study.revision);
    // Before flagging: the completion is honestly pending on the test, and
    // nothing pauses (no dispute exists).
    const before = await getAssessment(a, study.rootId);
    expect(before.completionPaused).toBe(false);
    expect(before.disputes).toEqual([]);
    expect(before.currentAward).toBeNull();

    // Flag the 79.96%-deciding fifth item: the flag (3.5 shape) opens the
    // dispute in the same transaction — the item enters Under review.
    const flagged = await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    expect(flagged).toMatchObject({ state: 'flagged', evidenceKind: 'attempt', evidenceId: attemptId, position: 5, flagged: true });
    const after = await getAssessment(a, study.rootId);
    expect(after.disputes).toHaveLength(1);
    expect(after.disputes[0]).toMatchObject({ evidenceKind: 'attempt', evidenceId: attemptId, position: 5, status: 'under-review', courseVersion: 1, replacements: [] });
    // Pin the position→group mapping (review disposition 2026-10-29: the old
    // >=0 assertion was vacuous): this 3-outcome fixture puts the boundary
    // item at position 5 in objective group 1 (positions 2+5 = 1999/4003).
    expect(after.disputes[0].objectiveIndex).toBe(1);
    // The pause: the STUDIED release's pending completion decision pauses;
    // no award row exists and the node stays honestly In progress.
    expect(after.completionPaused).toBe(true);
    expect(after.currentAward).toBeNull();
    expect(after.awards).toEqual([]);
    expect(after.node).toBe('in-progress');
    const awardRows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.completion_award WHERE root_id=$1', [study.rootId]);
    expect(awardRows.rows[0].count).toBe(0);
    // The dispute row IS keyed one-to-one to the flag row.
    const disputeRows = await database().query<{ count: number; status: string }>('SELECT count(*)::int AS count, max(status) AS status FROM app.item_dispute WHERE root_id=$1', [study.rootId]);
    expect(disputeRows.rows[0].count).toBe(1);
    expect(disputeRows.rows[0].status).toBe('under-review');
    // Prior evidence retained byte-identically: the failed attempt row and
    // its ledger are untouched by flagging/dispute-opening.
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]).toMatchObject({ attemptId, passed: false, displayPercent: '79.96%' });
    expect(after.recovery?.rootAttemptId).toBe(attemptId);
    expect(after.recovery?.targets.filter(target => target.status === 'open').length).toBeGreaterThan(0);
    expect(graded.earnedPoints).toBe(7996);

    // ONLY the affected pending completion pauses: another learner's study
    // completes normally while this one is paused.
    const { identity: b, study: studyB } = await readyStudyWithRequiredDone('dispute-unaffected');
    const passB = await startTest(b, studyB.rootId, { ...command(studyB.revision) });
    const snapshotB = await snapshotOf(passB.operationId);
    await submitAttempt(b, studyB.rootId, passB.operationId, { ...command(studyB.revision), attemptId: passB.operationId, answers: answersFrom(snapshotB) });
    const completedB = await getAssessment(b, studyB.rootId);
    expect(completedB.node).toBe('completed');
    expect(completedB.currentAward).not.toBeNull();
    expect(completedB.completionPaused).toBe(false);
  });

  it('a corrected replacement satisfies the requirement without an extra failed attempt', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('dispute-corrected');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    const paused = await getAssessment(a, study.rootId);
    expect(paused.completionPaused).toBe(true);
    const disputeId = paused.disputes[0]!.disputeId;

    // Start the corrected replacement: fresh comparable questions for the
    // disputed item's whole objective group, root policy pinned.
    const started = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId });
    expect(started).toMatchObject({ state: 'active', disputeId, planRevisionId: study.planRevisionId });
    const replacementSnapshot = await replacementSnapshotOf(started.operationId);
    expect(replacementSnapshot.testId).toBe('corrected-replacement-1');
    expect(replacementSnapshot.items.length).toBeGreaterThanOrEqual(1);
    // Fresh questions: the replacement prompts are NOT the root prompts.
    const rootSnapshot = await snapshotOf(attemptId);
    for (const item of replacementSnapshot.items)
      expect(rootSnapshot.items.some(rootItem => rootItem.prompt === item.prompt)).toBe(false);

    // Submit a group-clearing answer set: the dispute resolves CORRECTED,
    // the pause lifts and the award lands — with the ordinary-attempt list
    // UNCHANGED (no extra failed attempt anywhere) and the original row
    // byte-identical.
    const submitCommand = { ...command(study.revision), replacementId: started.operationId, answers: answersFrom(replacementSnapshot) };
    const graded = await submitReplacement(a, study.rootId, started.operationId, submitCommand);
    expect(graded.state).toBe('graded');
    expect(graded.group.cleared).toBe(true);
    expect(graded.group.earned).toBe(graded.group.total);
    const resolved = await getAssessment(a, study.rootId);
    expect(resolved.disputes[0]).toMatchObject({ status: 'corrected', resolvedByReplacement: started.operationId });
    expect(resolved.completionPaused).toBe(false);
    expect(resolved.node).toBe('completed');
    expect(resolved.currentAward).not.toBeNull();
    // No extra ordinary attempt: the history still lists exactly the ONE
    // 79.96% attempt, unrewritten; the correction lives in its own rows.
    expect(resolved.attempts).toHaveLength(1);
    expect(resolved.attempts[0]).toMatchObject({ attemptId, passed: false, displayPercent: '79.96%', earnedPoints: 7996 });
    expect(resolved.recovery?.requirementSatisfied).toBe(true);
    const replacementRows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.assessment_replacement WHERE root_id=$1', [study.rootId]);
    expect(replacementRows.rows[0].count).toBe(1);
    // The dispute cannot re-open: a replacement start on a corrected
    // dispute is CONFLICT.
    await expect(startReplacement(a, study.rootId, { ...command(study.revision), disputeId })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Replay: the same commandKey returns the identical graded view.
    const replayed = await submitReplacement(a, study.rootId, started.operationId, submitCommand);
    expect(replayed).toEqual(graded);

    // Denial taxonomy: another owner's dispute and an unknown dispute id
    // read as absent — no leak.
    const foreign = await actor('dispute-foreign');
    await expect(startReplacement(foreign, study.rootId, { ...command(study.revision), disputeId })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(startReplacement(a, study.rootId, { ...command(study.revision), disputeId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('a non-clearing replacement records no failed attempt and the dispute stays Under review (unlimited retries)', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('dispute-retry');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    const disputeId = (await getAssessment(a, study.rootId)).disputes[0]!.disputeId;

    // First replacement: every answer wrong — honestly graded, clears
    // nothing, records NO failed attempt (the ordinary-attempt count is
    // unchanged) and the dispute stays Under review.
    const first = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId });
    const firstSnapshot = await replacementSnapshotOf(first.operationId);
    const wrong = firstSnapshot.items.map(item => ({ position: item.position, choiceId: item.choices.find(choice => choice.id !== item.answerId)!.id }));
    const failedFirst = await submitReplacement(a, study.rootId, first.operationId, { ...command(study.revision), replacementId: first.operationId, answers: wrong });
    expect(failedFirst.group.cleared).toBe(false);
    const afterFirst = await getAssessment(a, study.rootId);
    expect(afterFirst.disputes[0]).toMatchObject({ status: 'under-review' });
    expect(afterFirst.completionPaused).toBe(true);
    expect(afterFirst.attempts).toHaveLength(1); // no extra ordinary attempt
    expect(afterFirst.node).toBe('in-progress');

    // Unlimited retries: a fresh replacement follows the graded one and the
    // clearing submission resolves the dispute.
    const second = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId });
    const secondSnapshot = await replacementSnapshotOf(second.operationId);
    await submitReplacement(a, study.rootId, second.operationId, { ...command(study.revision), replacementId: second.operationId, answers: answersFrom(secondSnapshot) });
    const resolved = await getAssessment(a, study.rootId);
    expect(resolved.disputes[0]).toMatchObject({ status: 'corrected' });
    expect(resolved.node).toBe('completed');
    expect(resolved.attempts).toHaveLength(1); // still no extra failed attempt
  });

  it('a previously earned pass and completion stand when the item is disputed later', async () => {
    const { identity: a, study, course } = await readyStudyWithRequiredDone('dispute-earned');
    const courseId = course.course.courseId;
    // Earn the completion normally: a passing attempt over the done items.
    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    const snapshot = await snapshotOf(started.operationId);
    const passed = await submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: answersFrom(snapshot) });
    expect(passed.passed).toBe(true);
    const earned = await getAssessment(a, study.rootId);
    expect(earned.node).toBe('completed');
    expect(earned.currentAward).not.toBeNull();
    const awardId = earned.currentAward!.awardId;

    // Flag an item of the EARNED pass: the dispute opens Under review, but
    // nothing earned is revoked — the award stays served and the node stays
    // Completed; only pending decisions ever pause, and none is pending.
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: started.operationId, position: 5 });
    const flagged = await getAssessment(a, study.rootId);
    expect(flagged.disputes[0]).toMatchObject({ status: 'under-review', evidenceId: started.operationId, position: 5 });
    expect(flagged.completionPaused).toBe(false);
    expect(flagged.node).toBe('completed');
    expect(flagged.currentAward?.awardId).toBe(awardId);
    expect(flagged.awards).toHaveLength(1);
    // The pass row is byte-identical: still the one passing attempt.
    expect(flagged.attempts).toHaveLength(1);
    expect(flagged.attempts[0]).toMatchObject({ attemptId: started.operationId, passed: true });
    const awardRows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.completion_award WHERE root_id=$1', [study.rootId]);
    expect(awardRows.rows[0].count).toBe(1);
    // Optional corrected practice on the earned case: a clearing
    // replacement resolves the dispute (annotated) and the award count
    // stays exactly one — never re-derived, never revoked.
    const disputeId = flagged.disputes[0]!.disputeId;
    const replacement = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId });
    const replacementSnapshot = await replacementSnapshotOf(replacement.operationId);
    await submitReplacement(a, study.rootId, replacement.operationId, { ...command(study.revision), replacementId: replacement.operationId, answers: answersFrom(replacementSnapshot) });
    const corrected = await getAssessment(a, study.rootId);
    expect(corrected.disputes[0]).toMatchObject({ status: 'corrected' });
    expect(corrected.awards).toHaveLength(1);
    expect(corrected.node).toBe('completed');
    // The earned course release pin never moved.
    expect(corrected.currentAward?.courseId).toBe(courseId);
  });

  it('exhausting the generation quota yields an honest delay with saved work and zero attempt records', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('dispute-quota');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    const disputeId = (await getAssessment(a, study.rootId)).disputes[0]!.disputeId;

    // Seed the owner's daily fresh-generation budget at its cap (the
    // planted-fixture precedent: the test owns this row directly).
    await database().query(
      `INSERT INTO app.assessment_generation_use(id,owner_id,day,used)
       VALUES($1,$2,(clock_timestamp() AT TIME ZONE 'utc')::date,$3)
       ON CONFLICT (owner_id, day) DO UPDATE SET used=EXCLUDED.used`,
      [crypto.randomUUID(), a.userId, 20],
    );

    // A retest start over the budget is denied RATE_LIMITED and records
    // ZERO rows of any kind — no retest, no attempt, no failed-attempt
    // record anywhere (the transaction rolled back).
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.retest_attempt WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(0);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.test_attempt WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(1);
    // The denial consumed nothing: the counter still reads the cap (the
    // failed verb's increment rolled back with it).
    expect((await database().query<{ used: number }>('SELECT used FROM app.assessment_generation_use WHERE owner_id=$1', [a.userId])).rows[0].used).toBe(20);
    // A replacement start is denied the same way, with zero rows.
    await expect(startReplacement(a, study.rootId, { ...command(study.revision), disputeId })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.assessment_replacement WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(0);
    // Saved work: the failed attempt, its ledger, the dispute and the
    // marked-done items are all unchanged by the denials.
    const saved = await getAssessment(a, study.rootId);
    expect(saved.attempts).toHaveLength(1);
    expect(saved.recovery?.targets.length).toBeGreaterThan(0);
    expect(saved.disputes[0]).toMatchObject({ status: 'under-review' });
    expect(saved.generation).toMatchObject({ dailyLimit: 20, usedToday: 20 });
    expect(saved.completionPaused).toBe(true); // the dispute still pauses; the quota is not a learning state

    // Reset the budget (the day's counter is the only input): starts work
    // again — the delay was honest, nothing was lost.
    await database().query(`UPDATE app.assessment_generation_use SET used=0 WHERE owner_id=$1`, [a.userId]);
    const retest = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [1] });
    expect(retest.state).toBe('active');
    expect((await getAssessment(a, study.rootId)).generation.usedToday).toBe(1);
  });

  it('unlimited pedagogical retries hold across the chain (the only limit is the named resource budget)', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('dispute-unlimited');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);

    // Failed retests never lock anything: each graded retest can be
    // followed by a fresh one, and the open target honestly persists.
    for (let round = 0; round < 3; round += 1) {
      const retest = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [1] });
      const snapshot = await retestSnapshotOf(retest.operationId);
      const wrong = snapshot.items.map(item => ({ position: item.position, choiceId: item.choices.find(choice => choice.id !== item.answerId)!.id }));
      await submitRetest(a, study.rootId, retest.operationId, { ...command(study.revision), retestId: retest.operationId, answers: wrong });
      const mid = await getAssessment(a, study.rootId);
      expect(mid.recovery?.targets.every(target => target.status === 'open')).toBe(true);
    }
    // The clearing retest satisfies the group — recovery works after any
    // number of failed rounds.
    const clearing = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [1] });
    const clearingSnapshot = await retestSnapshotOf(clearing.operationId);
    await submitRetest(a, study.rootId, clearing.operationId, { ...command(study.revision), retestId: clearing.operationId, answers: answersFrom(clearingSnapshot) });
    const recovered = await getAssessment(a, study.rootId);
    expect(recovered.recovery?.requirementSatisfied).toBe(true);
    expect(recovered.node).toBe('completed');

    // Ordinary retakes are unlimited and never counted against the budget:
    // a fresh ordinary attempt after completion starts freely.
    const retake = await startTest(a, study.rootId, { ...command(study.revision) });
    expect(retake.state).toBe('active');
    // Four retest generations consumed; the budget names them and nothing
    // else (the ordinary retake drew the fixed root bank, uncounted).
    expect((await getAssessment(a, study.rootId)).generation.usedToday).toBe(4);
  });
});
