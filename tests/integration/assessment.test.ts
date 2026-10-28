import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { removeRoot } from '../../src/modules/lifecycle-platform/service';
import { requestCourseGeneration, getCourse, markItemDone } from '../../src/modules/course-generation/service';
import { runCourseGeneration } from '../../src/modules/course-generation/worker';
import { getAssessment, startTest, submitAttempt, startRetest, submitRetest, getSwitchDisclosure, switchCourseVersion, recordCompletionIfEarned } from '../../src/modules/assessment-progress/service';
import { insertAttempt, insertParentManifest } from '../../src/modules/assessment-progress/repository';
import { buildSnapshot, buildPartialCreditSnapshot } from '../../src/modules/assessment-progress/bank';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AttemptSnapshot, PartialCreditSnapshot, RetestSnapshot } from '../../src/contracts/assessment';

// LOCAL SYNTHETIC coverage of the epic-3 story-1 scored-attempt tracer and
// the story-2 targeted-recovery chain: one required test over a ready
// generated course — at-start snapshot pinning (supersession stability),
// exactly-once submission (same commandKey replays the identical result, a
// new commandKey on a graded attempt conflicts), answer withholding until
// grading, the honest 79.96% threshold boundary driving the DERIVED roadmap
// node (In progress -> Completed), the denial sweep — plus story 2's matrix:
// a failed grade ledgers exactly its failed objective groups under its own
// snapshot, retests mirror the root blueprint with fresh questions, a group
// clears only at the root mark, partial recovery keeps the requirement
// honestly open, the later clear satisfies it with the original score row
// byte-identical, chains stay pinned through supersession and retakes
// re-ledger under their own snapshot — plus story 3's surface: a disclosed
// finite-precision partial-credit rubric graded exactly through the real
// verbs at the declared hundredths scale, the carried instructor pass-mark
// override pinned on a running attempt while the next attempt snapshots the
// current default policy, and every graded view served as a final grade
// decision. Real PostgreSQL; the processor is the
// local synthetic fixture — zero network, and the assessment itself
// dispatches nothing.

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
// usable daily quota — sibling suites (ai-draft's quota boundary leaves an
// eligible limit-1 fixture as current) — otherwise pin this file's own
// clearly-labeled eligible fixture above it.
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

// The stored answer key of one attempt, read straight from the snapshot row
// (server-side truth the tests grade against — never a served view).
async function snapshotOf(attemptId: string): Promise<AttemptSnapshot> {
  const row = await database().query<{ snapshot: AttemptSnapshot }>('SELECT snapshot FROM app.test_attempt WHERE id=$1', [attemptId]);
  if (!row.rows[0]) throw new Error('no attempt row');
  return row.rows[0].snapshot;
}

// The stored answer key of one retest, likewise server-side truth only.
async function retestSnapshotOf(retestId: string): Promise<RetestSnapshot> {
  const row = await database().query<{ snapshot: RetestSnapshot }>('SELECT snapshot FROM app.retest_attempt WHERE id=$1', [retestId]);
  if (!row.rows[0]) throw new Error('no retest row');
  return row.rows[0].snapshot;
}

// Answers built from a stored snapshot: wrong on the given positions, correct
// everywhere else.
function answersFrom(snapshot: AttemptSnapshot | RetestSnapshot, wrongPositions: number[] = []) {
  return snapshot.items.map(item => ({
    position: item.position,
    choiceId: wrongPositions.includes(item.position) ? item.choices.find(choice => choice.id !== item.answerId)!.id : item.answerId,
  }));
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-3 story-1: scored-attempt tracer', () => {
  it('offers the disclosure, pins a snapshot, grades the 79.96% boundary honestly and completes the node', async () => {
    const a = await actor('assessment-happy');
    await grant(a);
    const study = await confirmedStudy(a);
    const course = await generateCourse(a, study.rootId, study.revision);
    const courseId = course.course.courseId;

    // Offered BEFORE any start: threshold, available points, scoring criteria
    // — and no answer anywhere in the payload.
    const offered = await getAssessment(a, study.rootId);
    expect(offered.state).toBe('offered');
    expect(offered.node).toBe('not-started');
    expect(offered.test).toMatchObject({ testId: 'required-test-1', passMarkPercent: 80, totalPoints: 10000, itemCount: 5, itemPoints: [1999, 1999, 1999, 1999, 2004] });
    expect(offered.test!.answerRule).toContain('Single choice per item');
    expect(offered.test!.rubric).toContain('Full credit only');
    expect(offered.attempts).toEqual([]);
    expect(JSON.stringify(offered)).not.toContain('"answerId"');
    expect(JSON.stringify(offered)).not.toContain('"correctChoiceId"');

    // Start pins the latest ready course version into the snapshot.
    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    expect(started.state).toBe('active');
    expect(started.planRevisionId).toBe(study.planRevisionId);
    const active = await getAssessment(a, study.rootId);
    expect(active.state).toBe('active');
    expect(active.node).toBe('in-progress'); // an open attempt is real engagement
    if (active.attempt && !('gradedAt' in active.attempt)) {
      expect(active.attempt.items).toHaveLength(5);
      expect(active.attempt.courseVersion).toBe(1);
      for (const item of active.attempt.items) expect(Object.keys(item).sort()).toEqual(['choices', 'objective', 'objectiveIndex', 'points', 'position', 'prompt']);
    } else {
      throw new Error('expected an active attempt view');
    }
    // Withholding: the active view carries prompts and choices only.
    const activeSerialized = JSON.stringify(active);
    expect(activeSerialized).not.toContain('"answerId"');
    expect(activeSerialized).not.toContain('"correctChoiceId"');

    // A repeat start while the attempt is open returns the SAME pinned
    // attempt — never a parallel duplicate.
    const repeatedStart = await startTest(a, study.rootId, { ...command(study.revision) });
    expect(repeatedStart.operationId).toBe(started.operationId);
    const openRows = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.test_attempt WHERE root_id=$1 AND status='active'", [study.rootId]);
    expect(openRows.rows[0].count).toBe(1);

    // Boundary submission: correct on the first four items, wrong on the
    // 2004-point fifth — 7996/10000 = 79.96%, below the 80% mark.
    const snapshot = await snapshotOf(started.operationId);
    const wrongFifth = snapshot.items[4].choices.find(choice => choice.id !== snapshot.items[4].answerId)!.id;
    const boundaryAnswers = snapshot.items.map(item => ({ position: item.position, choiceId: item.position === 5 ? wrongFifth : item.answerId }));
    const submitCommand = { ...command(study.revision), attemptId: started.operationId, answers: boundaryAnswers };
    const graded = await submitAttempt(a, study.rootId, started.operationId, submitCommand);
    expect(graded.state).toBe('graded');
    expect(graded.earnedPoints).toBe(7996);
    expect(graded.totalPoints).toBe(10000);
    expect(graded.passed).toBe(false);
    expect(graded.displayPercent).toBe('79.96%');
    expect(graded.verdict).toBe('79.96% — Not passed (mark is 80%)');
    // The graded view is the sole reveal path: per-item correct answers now.
    expect(graded.items[4].correctChoiceId).toBe(snapshot.items[4].answerId);
    expect(graded.items[4].chosenChoiceId).toBe(wrongFifth);
    expect(graded.items[4].earned).toBe(0);
    expect(graded.items[0].earned).toBe(1999);

    // Exactly once: the same commandKey replays the identical result and one
    // graded row exists; a NEW commandKey on the graded attempt conflicts.
    const replayed = await submitAttempt(a, study.rootId, started.operationId, submitCommand);
    expect(replayed).toEqual(graded);
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.test_attempt WHERE root_id=$1', [study.rootId]);
    expect(rows.rows[0].count).toBe(1);
    await expect(submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: boundaryAnswers })).rejects.toMatchObject({ code: 'CONFLICT' });

    // The node honestly reads In progress until the required items are done
    // AND a passing attempt exists on the current version.
    const afterFail = await getAssessment(a, study.rootId);
    expect(afterFail.state).toBe('graded');
    expect(afterFail.node).toBe('in-progress');
    expect(afterFail.attempts).toHaveLength(1);
    expect(afterFail.attempts[0]).toMatchObject({ status: 'graded', passed: false, displayPercent: '79.96%' });

    // Mark the course's required reading done (the epic-2 tracker verb).
    for (const item of course.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId, itemId: item.id });
    const requiredDone = await getAssessment(a, study.rootId);
    expect(requiredDone.node).toBe('in-progress'); // still no passing attempt

    // Retake (no pedagogical limit): a fresh attempt, all correct — 100%,
    // pass, and the node completes. The failed attempt stays listed.
    const retake = await startTest(a, study.rootId, { ...command(study.revision) });
    expect(retake.operationId).not.toBe(started.operationId);
    const retakeSnapshot = await snapshotOf(retake.operationId);
    const allCorrect = retakeSnapshot.items.map(item => ({ position: item.position, choiceId: item.answerId }));
    const passed = await submitAttempt(a, study.rootId, retake.operationId, { ...command(study.revision), attemptId: retake.operationId, answers: allCorrect });
    expect(passed.passed).toBe(true);
    expect(passed.displayPercent).toBe('100.0%');
    expect(passed.verdict).toBe('100.0% — Pass (mark is 80%)');
    const completed = await getAssessment(a, study.rootId);
    expect(completed.node).toBe('completed');
    expect(completed.attempts).toHaveLength(2); // history listed, never overwritten
    expect(completed.attempts.map(attempt => attempt.passed)).toEqual([true, false]);

    // Story 4: the completing submit awarded EXACTLY ONE version-scoped row
    // (the replayed submit above returned the identical receipt and inserted
    // nothing new) — the node reads Completed FROM the award and the served
    // state lists it with its timestamp.
    const awardRows = await database().query<{ id: string; kind: string; course_id: string; course_version: number; awarded_at: Date }>(
      'SELECT id,kind,course_id,course_version,awarded_at FROM app.completion_award WHERE root_id=$1',
      [study.rootId],
    );
    expect(awardRows.rows).toHaveLength(1);
    expect(awardRows.rows[0]).toMatchObject({ kind: 'mini-course', course_id: courseId, course_version: 1 });
    expect(completed.awards).toHaveLength(1);
    expect(completed.currentAward).toMatchObject({ kind: 'mini-course', courseId, courseVersion: 1, manifest: null });
    expect(completed.currentAward!.awardId).toBe(awardRows.rows[0].id);
    expect(completed.currentAward!.awardedAt).toBe(awardRows.rows[0].awarded_at.toISOString());
    expect(completed.versions).toEqual([1]);

    // The recorded submit receipts are content-free: no answers, no attempt
    // text, no score fields ride command_receipt.result.
    const receipts = await database().query<{ result: unknown }>("SELECT result FROM app.command_receipt WHERE root_id=$1 AND action='submit-test'", [study.rootId]);
    expect(receipts.rows).toHaveLength(2);
    for (const { result } of receipts.rows) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('answer');
      expect(serialized).not.toContain('choiceId');
      expect(serialized).not.toContain('earnedPoints');
      expect(serialized).not.toContain('passed');
    }
  });

  it('pins the snapshot at start: a superseding course version never changes an open attempt', async () => {
    const a = await actor('assessment-supersede');
    await grant(a);
    const study = await confirmedStudy(a);
    await generateCourse(a, study.rootId, study.revision);
    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    const pinnedSnapshot = await snapshotOf(started.operationId);

    // Re-confirm a changed plan and generate version 2 — while the attempt
    // on version 1 stays open.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...plan, topic: 'Unit testing, second edition' }, extractionId: study.extractionId, selectionId: study.selectionId });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await generateCourse(a, study.rootId, confirmed.revision);
    const course = await getCourse(a, study.rootId);
    if (course.state !== 'ready') throw new Error('course not ready');
    expect(course.course.version).toBe(2);

    // Start now pins the LATEST ready version (2); the open attempt keeps its
    // version-1 pin — one open attempt per root, returned as-is, and the
    // result describes THAT attempt's own plan revision, not the freshly
    // resolved current course's.
    const reoffered = await startTest(a, study.rootId, { ...command(confirmed.revision) });
    expect(reoffered.operationId).toBe(started.operationId);
    expect(reoffered.planRevisionId).toBe(started.planRevisionId);

    // Submitting the version-1-pinned attempt after supersession grades
    // against ITS snapshot only: same questions, same verdict, unchanged row.
    const wrongFifth = pinnedSnapshot.items[4].choices.find(choice => choice.id !== pinnedSnapshot.items[4].answerId)!.id;
    const answers = pinnedSnapshot.items.map(item => ({ position: item.position, choiceId: item.position === 5 ? wrongFifth : item.answerId }));
    const graded = await submitAttempt(a, study.rootId, started.operationId, { ...command(confirmed.revision), attemptId: started.operationId, answers });
    expect(graded.courseVersion).toBe(1);
    expect(graded.earnedPoints).toBe(7996);
    expect(graded.verdict).toBe('79.96% — Not passed (mark is 80%)');
    expect(await snapshotOf(started.operationId)).toEqual(pinnedSnapshot);

    // The served state resolves the CURRENT version (2): the version-1 pass
    // would not complete it — here no pass exists at all, so the node stays
    // honestly In progress with both attempts listed on their pins.
    const state = await getAssessment(a, study.rootId);
    expect(state.version).toBe(2);
    expect(state.node).toBe('in-progress');
    expect(state.attempts.map(attempt => attempt.courseVersion)).toEqual([1]);
    expect(state.attempt && 'gradedAt' in state.attempt ? state.attempt.courseVersion : null).toBe(1);
  });

  it('denies cross-owner, deleted-root and malformed requests with zero leak or effect', async () => {
    const a = await actor('assessment-denied-a');
    await grant(a);
    const study = await confirmedStudy(a);
    await generateCourse(a, study.rootId, study.revision);
    const started = await startTest(a, study.rootId, { ...command(study.revision) });

    // Cross-owner: B never sees A's assessment by any verb.
    const b = await actor('assessment-denied-b');
    for (const verb of [
      () => getAssessment(b, study.rootId),
      () => startTest(b, study.rootId, { ...command(study.revision) }),
      () => submitAttempt(b, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: [] }),
    ]) await expect(verb()).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    // Malformed bodies and unknown references.
    await expect(startTest(a, study.rootId, { schemaVersion: 2, commandKey: crypto.randomUUID(), expectedRevision: study.revision })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startTest(a, 'not-a-uuid', command())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const snapshot = await snapshotOf(started.operationId);
    await expect(submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: [{ position: 1, choiceId: 'zz' }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: [{ position: 9, choiceId: snapshot.items[0].answerId }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: [{ position: 1, choiceId: snapshot.items[0].answerId }, { position: 1, choiceId: snapshot.items[0].answerId }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitAttempt(a, study.rootId, crypto.randomUUID(), { ...command(study.revision), attemptId: crypto.randomUUID(), answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Stale expectedRevision conflicts honestly.
    await expect(startTest(a, study.rootId, { ...command(study.revision + 5) })).rejects.toMatchObject({ code: 'CONFLICT' });

    // Unconfirmed study: honest none, no error; start conflicts.
    const fresh = await actor('assessment-unconfirmed');
    const slotId = crypto.randomUUID();
    const batch = await createBatch(fresh, { ...command(), inputs: [{ slotId, filename: 'x.txt', mime: 'text/plain', byteLength: 8 }] });
    const none = await getAssessment(fresh, batch.rootId);
    expect(none.state).toBe('none');
    expect(none.node).toBe('not-started');
    expect(none.test).toBeNull();
    await expect(startTest(fresh, batch.rootId, command())).rejects.toMatchObject({ code: 'CONFLICT' });

    // Deleted root: the same no-leak denial, and the attempt rows are gone
    // with the course lineage (cascade).
    const current = await getBatch(a, study.rootId);
    await removeRoot(a, study.rootId, command(current.revision));
    await expect(getAssessment(a, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(submitAttempt(a, study.rootId, started.operationId, { ...command(current.revision), attemptId: started.operationId, answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const remaining = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.test_attempt WHERE root_id=$1', [study.rootId]);
    expect(remaining.rows[0].count).toBe(0);
  });
});

describe('epic-3 story-2: targeted recovery ledger and fresh retest chain', () => {
  // The plan's 5997 fixture over the default 3-outcome study: wrong on items
  // 3 (obj2) and 5 (obj1) fails exactly groups obj1+obj2 while obj0 (items
  // 1,4) passes — obj0 is preserved and never re-tested.
  it('ledgers exactly the failed groups at grade time, clears them one retest at a time, and completes the node with the original row byte-identical', async () => {
    const a = await actor('recovery-happy');
    await grant(a);
    const study = await confirmedStudy(a);
    const course = await generateCourse(a, study.rootId, study.revision);
    const courseId = course.course.courseId;

    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    const rootSnapshot = await snapshotOf(started.operationId);
    expect(rootSnapshot.items.map(item => item.objectiveIndex)).toEqual([0, 1, 2, 0, 1]);
    const graded = await submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: answersFrom(rootSnapshot, [3, 5]) });
    expect(graded.earnedPoints).toBe(5997);
    expect(graded.verdict).toBe('60.0% — Not passed (mark is 80%)');

    // The failed grade ledgered EXACTLY the failed groups, open, with initial
    // results under that attempt's own snapshot — same transaction.
    const ledgerRows = await database().query<{ objective_index: number; initial_earned: number; initial_total: number; status: string }>(
      'SELECT objective_index,initial_earned,initial_total,status FROM app.recovery_target WHERE root_attempt_id=$1 ORDER BY objective_index',
      [started.operationId],
    );
    expect(ledgerRows.rows).toEqual([
      { objective_index: 1, initial_earned: 1999, initial_total: 4003, status: 'open' },
      { objective_index: 2, initial_earned: 0, initial_total: 1999, status: 'open' },
    ]);

    // Served state: recovery beside the attempt result, requirement open,
    // original verdict shown, never merged.
    const afterFail = await getAssessment(a, study.rootId);
    expect(afterFail.state).toBe('graded');
    expect(afterFail.node).toBe('in-progress');
    expect(afterFail.attempt && 'gradedAt' in afterFail.attempt ? afterFail.attempt.verdict : null).toBe('60.0% — Not passed (mark is 80%)');
    expect(afterFail.recovery).toMatchObject({ rootAttemptId: started.operationId, requirementSatisfied: false });
    expect(afterFail.recovery!.targets).toEqual([
      expect.objectContaining({ objectiveIndex: 1, initialEarned: 1999, initialTotal: 4003, status: 'open', initialDisplayPercent: '49.9%' }),
      expect.objectContaining({ objectiveIndex: 2, initialEarned: 0, initialTotal: 1999, status: 'open' }),
    ]);
    expect(afterFail.recovery!.retest).toBeNull();
    expect(afterFail.recovery!.retests).toEqual([]);
    // Withholding: the graded attempt view is the sole reveal path for the
    // attempt's answers (correctChoiceId appears there legitimately); the
    // recovery state itself carries no answer of any kind — nothing is
    // revealed through the ledger before a retest grades.
    const failedSerialized = JSON.stringify(afterFail.recovery);
    expect(failedSerialized).not.toContain('answerId');
    expect(failedSerialized).not.toContain('correctChoiceId');

    // Foreign target declarations are INVALID_INPUT, never repaired: a
    // PASSED group (obj0), a cleared/unknown index, duplicates.
    const retestBase = { ...command(study.revision), attemptId: started.operationId };
    await expect(startRetest(a, study.rootId, { ...retestBase, targetIndexes: [0] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...retestBase, targetIndexes: [5] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [1, 1] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: crypto.randomUUID(), targetIndexes: [1] })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    // Retest 1 targets {obj1, obj2}: fresh items mirroring the root blueprint
    // per-group one-for-one (obj1 1999+2004, obj2 1999), the root pass mark.
    const firstStartCommand = { ...command(study.revision), attemptId: started.operationId, targetIndexes: [1, 2] };
    const firstStart = await startRetest(a, study.rootId, firstStartCommand);
    expect(firstStart).toMatchObject({ state: 'active', targetIndexes: [1, 2] });
    expect(firstStart.planRevisionId).toBe(started.planRevisionId);
    const firstSnapshot = await retestSnapshotOf(firstStart.operationId);
    expect(firstSnapshot.items.map(item => [item.objectiveIndex, item.points, item.position])).toEqual([[1, 1999, 1], [2, 1999, 2], [1, 2004, 3]]);
    expect(firstSnapshot.totalPoints).toBe(6002);
    expect(firstSnapshot.passMarkPercent).toBe(rootSnapshot.passMarkPercent);
    for (const item of firstSnapshot.items) {
      const counterpart = rootSnapshot.items.find(root => root.objectiveIndex === item.objectiveIndex && root.points === item.points)!;
      expect(item.prompt).not.toBe(counterpart.prompt); // fresh questions
      expect(item.objective).toBe(counterpart.objective);
    }
    // Active retest withholds answers too.
    const activeRetest = await getAssessment(a, study.rootId);
    expect(JSON.stringify(activeRetest.recovery!.retest)).not.toContain('"answerId"');
    // Duplicate retest command (same commandKey) replays the identical
    // receipt — one tracked retest row; a different commandKey while one is
    // open returns the SAME open retest with ITS OWN declaration.
    const replayedStart = await startRetest(a, study.rootId, firstStartCommand);
    expect(replayedStart).toEqual(firstStart);
    const secondKeyStart = await startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [2] });
    expect(secondKeyStart.operationId).toBe(firstStart.operationId);
    expect(secondKeyStart.targetIndexes).toEqual([1, 2]);
    // Foreign declarations are rejected in EVERY state — including while an
    // open retest exists (the served winner never excuses a bad declaration):
    // a passed group, an index no item carries, and duplicates all conflict.
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [0] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [5] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [1, 1] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const retestRowsMid = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.retest_attempt WHERE root_id=$1', [study.rootId]);
    expect(retestRowsMid.rows[0].count).toBe(1);

    // Partial clear: correct on both obj1 items, wrong on the obj2 item.
    const firstSubmit = { ...command(study.revision), retestId: firstStart.operationId, answers: answersFrom(firstSnapshot, [2]) };
    const firstGraded = await submitRetest(a, study.rootId, firstStart.operationId, firstSubmit);
    expect(firstGraded.groups).toEqual([
      expect.objectContaining({ objectiveIndex: 1, earned: 4003, total: 4003, cleared: true }),
      expect.objectContaining({ objectiveIndex: 2, earned: 0, total: 1999, cleared: false }),
    ]);
    // Exactly-once: same commandKey replays the identical result; a NEW
    // commandKey on the graded retest conflicts.
    expect(await submitRetest(a, study.rootId, firstStart.operationId, firstSubmit)).toEqual(firstGraded);
    await expect(submitRetest(a, study.rootId, firstStart.operationId, { ...command(study.revision), retestId: firstStart.operationId, answers: answersFrom(firstSnapshot, [2]) })).rejects.toMatchObject({ code: 'CONFLICT' });

    // One group cleared, the other open: the requirement stays honestly
    // unsatisfied; the original row is byte-identical; credit is separate.
    const partial = await getAssessment(a, study.rootId);
    expect(partial.node).toBe('in-progress');
    expect(partial.recovery!.requirementSatisfied).toBe(false);
    expect(partial.recovery!.targets.map(target => [target.objectiveIndex, target.status])).toEqual([[1, 'cleared'], [2, 'open']]);
    expect(partial.recovery!.targets[0].clearedBy).toBe(firstStart.operationId);
    expect(partial.recovery!.retests).toHaveLength(1);
    expect(partial.attempt && 'gradedAt' in partial.attempt ? [partial.attempt.earnedPoints, partial.attempt.verdict] : null).toEqual([5997, '60.0% — Not passed (mark is 80%)']);
    expect(await snapshotOf(started.operationId)).toEqual(rootSnapshot);
    const originalRow = await database().query('SELECT * FROM app.test_attempt WHERE id=$1', [started.operationId]);
    const originalBytes = JSON.stringify(originalRow.rows[0]);

    // A cleared group is no longer declarable.
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [1, 2] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Required items done, then the later retest clears the remainder.
    for (const item of course.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId, itemId: item.id });
    const secondStart = await startRetest(a, study.rootId, { ...command(study.revision), attemptId: started.operationId, targetIndexes: [2] });
    expect(secondStart.targetIndexes).toEqual([2]);
    const secondSnapshot = await retestSnapshotOf(secondStart.operationId);
    expect(secondSnapshot.items.map(item => [item.objectiveIndex, item.points])).toEqual([[2, 1999]]);
    const secondGraded = await submitRetest(a, study.rootId, secondStart.operationId, { ...command(study.revision), retestId: secondStart.operationId, answers: answersFrom(secondSnapshot) });
    expect(secondGraded.groups[0]).toMatchObject({ objectiveIndex: 2, earned: 1999, total: 1999, cleared: true });

    // Every target cleared: requirement satisfied and the node COMPLETES on
    // recovery credit with no passing ordinary attempt — and the original
    // score row is byte-identical throughout. Story 4: the final clearing
    // retest landed the version-scoped award (recovery IS completion per
    // AD-8) inside its own grade transaction.
    const recovered = await getAssessment(a, study.rootId);
    expect(recovered.recovery!.requirementSatisfied).toBe(true);
    expect(recovered.recovery!.targets.every(target => target.status === 'cleared')).toBe(true);
    expect(recovered.node).toBe('completed');
    expect(recovered.currentAward).toMatchObject({ kind: 'mini-course', courseId, courseVersion: 1 });
    expect(recovered.attempts).toHaveLength(1);
    expect(recovered.attempts[0].passed).toBe(false); // history never rewritten
    expect(recovered.attempt && 'gradedAt' in recovered.attempt ? recovered.attempt.verdict : null).toBe('60.0% — Not passed (mark is 80%)');
    const originalAfter = await database().query('SELECT * FROM app.test_attempt WHERE id=$1', [started.operationId]);
    expect(JSON.stringify(originalAfter.rows[0])).toBe(originalBytes);

    // The retest receipts are content-free: no answers, no group results.
    const retestReceipts = await database().query<{ result: unknown }>("SELECT result FROM app.command_receipt WHERE root_id=$1 AND action IN ('start-retest','submit-retest')", [study.rootId]);
    expect(retestReceipts.rows.length).toBeGreaterThanOrEqual(4);
    for (const { result } of retestReceipts.rows) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('answer');
      expect(serialized).not.toContain('choiceId');
      expect(serialized).not.toContain('cleared');
      expect(serialized).not.toContain('earned');
    }
  });

  it('pins the chain to the root attempt: supersession mid-chain never moves it and a retake re-ledgers under its own snapshot', async () => {
    const a = await actor('recovery-pinned');
    await grant(a);
    const study = await confirmedStudy(a);
    await generateCourse(a, study.rootId, study.revision);
    const failed = await startTest(a, study.rootId, { ...command(study.revision) });
    const failedSnapshot = await snapshotOf(failed.operationId);
    await submitAttempt(a, study.rootId, failed.operationId, { ...command(study.revision), attemptId: failed.operationId, answers: answersFrom(failedSnapshot, [3, 5]) });

    // Clear obj1 of the first chain before anything supersedes it.
    const first = await startRetest(a, study.rootId, { ...command(study.revision), attemptId: failed.operationId, targetIndexes: [1] });
    const firstSnapshot = await retestSnapshotOf(first.operationId);
    await submitRetest(a, study.rootId, first.operationId, { ...command(study.revision), retestId: first.operationId, answers: answersFrom(firstSnapshot) });

    // Retake the ordinary test and fail differently (wrong on items 1 and 3:
    // obj0 and obj2 fail this time): the NEW failed grade re-ledgers under
    // ITS own snapshot and the served chain roots at the new attempt; the
    // earlier chain stays durable and readable in its rows.
    const retake = await startTest(a, study.rootId, { ...command(study.revision) });
    const retakeSnapshot = await snapshotOf(retake.operationId);
    await submitAttempt(a, study.rootId, retake.operationId, { ...command(study.revision), attemptId: retake.operationId, answers: answersFrom(retakeSnapshot, [1, 3]) });
    const afterRetake = await getAssessment(a, study.rootId);
    expect(afterRetake.recovery!.rootAttemptId).toBe(retake.operationId);
    expect(afterRetake.recovery!.targets.map(target => [target.objectiveIndex, target.status])).toEqual([[0, 'open'], [2, 'open']]);
    expect(afterRetake.recovery!.retests).toEqual([]); // the new chain starts fresh
    const earlierRetest = await database().query<{ count: number; status: string }>('SELECT count(*)::int AS count, max(status::text) AS status FROM app.retest_attempt WHERE root_attempt_id=$1', [failed.operationId]);
    expect(earlierRetest.rows[0].count).toBe(1); // earlier chain intact and readable
    const earlierTargets = await database().query<{ objective_index: number; status: string }>('SELECT objective_index,status FROM app.recovery_target WHERE root_attempt_id=$1 ORDER BY objective_index', [failed.operationId]);
    expect(earlierTargets.rows).toEqual([{ objective_index: 1, status: 'cleared' }, { objective_index: 2, status: 'open' }]);

    // Supersession mid-chain: version 2 becomes current while the new
    // chain's targets are still open. Recovery stays pinned to the root
    // attempt's course version; the node derives from the current version
    // only — clearing everything still must NOT complete version 2's node.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...plan, topic: 'Unit testing, recovery edition' }, extractionId: study.extractionId, selectionId: study.selectionId });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await generateCourse(a, study.rootId, confirmed.revision);
    const superseded = await getAssessment(a, study.rootId);
    expect(superseded.version).toBe(2);
    expect(superseded.node).toBe('in-progress');
    expect(superseded.recovery!.rootAttemptId).toBe(retake.operationId); // pinned chain keeps serving

    // Clear both open targets of the pinned chain: requirement satisfied,
    // node STILL in progress (no pass and no recovery on the current
    // version) — the honest superseded-version answer, no error.
    const v1 = await startRetest(a, study.rootId, { ...command(confirmed.revision), attemptId: retake.operationId, targetIndexes: [0] });
    const v1Snapshot = await retestSnapshotOf(v1.operationId);
    await submitRetest(a, study.rootId, v1.operationId, { ...command(confirmed.revision), retestId: v1.operationId, answers: answersFrom(v1Snapshot) });
    const v2 = await startRetest(a, study.rootId, { ...command(confirmed.revision), attemptId: retake.operationId, targetIndexes: [2] });
    const v2Snapshot = await retestSnapshotOf(v2.operationId);
    await submitRetest(a, study.rootId, v2.operationId, { ...command(confirmed.revision), retestId: v2.operationId, answers: answersFrom(v2Snapshot) });
    const cleared = await getAssessment(a, study.rootId);
    expect(cleared.recovery!.requirementSatisfied).toBe(true);
    expect(cleared.node).toBe('in-progress'); // chain pinned to version 1
    // A passing ordinary attempt on the CURRENT version still completes it.
    const pass = await startTest(a, study.rootId, { ...command(confirmed.revision) });
    const passSnapshot = await snapshotOf(pass.operationId);
    await submitAttempt(a, study.rootId, pass.operationId, { ...command(confirmed.revision), attemptId: pass.operationId, answers: answersFrom(passSnapshot) });
    const passed = await getAssessment(a, study.rootId);
    expect(passed.node).toBe('in-progress'); // required items of v2 not done yet
  });

  it('denies cross-owner, unknown, stale and malformed recovery verbs with zero leak or effect, and the chain cascades with its root', async () => {
    const a = await actor('recovery-denied-a');
    await grant(a);
    const study = await confirmedStudy(a);
    await generateCourse(a, study.rootId, study.revision);
    const failed = await startTest(a, study.rootId, { ...command(study.revision) });
    const failedSnapshot = await snapshotOf(failed.operationId);
    await submitAttempt(a, study.rootId, failed.operationId, { ...command(study.revision), attemptId: failed.operationId, answers: answersFrom(failedSnapshot, [5]) });

    // A retest on an ACTIVE (not graded-failed) attempt conflicts; on a
    // PASSED attempt it conflicts too.
    const activeAttempt = await startTest(a, study.rootId, { ...command(study.revision) });
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: activeAttempt.operationId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'CONFLICT' });
    const passing = await submitAttempt(a, study.rootId, activeAttempt.operationId, { ...command(study.revision), attemptId: activeAttempt.operationId, answers: answersFrom(await snapshotOf(activeAttempt.operationId)) });
    expect(passing.passed).toBe(true);
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: activeAttempt.operationId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'CONFLICT' });
    // A PASSED attempt opens no recovery: its ledger is absent.
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.recovery_target WHERE root_attempt_id=$1', [activeAttempt.operationId])).rows[0].count).toBe(0);

    // Cross-owner: B never touches A's chain by any verb.
    const b = await actor('recovery-denied-b');
    for (const verb of [
      () => startRetest(b, study.rootId, { ...command(study.revision), attemptId: failed.operationId, targetIndexes: [1] }),
      () => submitRetest(b, study.rootId, crypto.randomUUID(), { ...command(study.revision), retestId: crypto.randomUUID(), answers: [] }),
    ]) await expect(verb()).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    // Malformed bodies, unknown ids and stale revisions follow the taxonomy.
    await expect(startRetest(a, study.rootId, { schemaVersion: 2, commandKey: crypto.randomUUID(), expectedRevision: study.revision, attemptId: failed.operationId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId: failed.operationId, targetIndexes: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(startRetest(a, study.rootId, { ...command(study.revision + 5), attemptId: failed.operationId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(submitRetest(a, study.rootId, crypto.randomUUID(), { ...command(study.revision), retestId: crypto.randomUUID(), answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    // Open a retest, then delete the root: the whole chain — ledger, retest,
    // targets — cascades with the course lineage.
    const open = await startRetest(a, study.rootId, { ...command(study.revision), attemptId: failed.operationId, targetIndexes: [1] });
    const current = await getBatch(a, study.rootId);
    await removeRoot(a, study.rootId, command(current.revision));
    await expect(getAssessment(a, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(submitRetest(a, study.rootId, open.operationId, { ...command(current.revision), retestId: open.operationId, answers: [] })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.retest_attempt WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(0);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.recovery_target WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(0);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.test_attempt WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Story 3 — the snapshotted scoring surface over the REAL verbs: a disclosed
// partial-credit rubric graded exactly at the declared hundredths scale, the
// carried instructor pass-mark override pinned on a running attempt while
// the next attempt snapshots the current (default) policy, and every graded
// view served as a final grade decision.
// ---------------------------------------------------------------------------

describe('epic-3 story-3: partial credit, carried override, pinned policy', () => {
  // Plant an OPEN attempt row through the module's own repository writer
  // with a snapshot from the module's own builders — the same rows a started
  // attempt would carry. The partial-credit fixture and an instructor
  // override have no served start path in personal study (the surface is
  // contract + builder); planting exercises the REAL grading/disclosure
  // machinery over them, exactly as a started attempt would be graded.
  async function plantOpenAttempt(identity: Identity, rootId: string, courseId: string, courseVersion: number, planRevisionId: string, snapshot: AttemptSnapshot | PartialCreditSnapshot) {
    const client = await database().connect();
    try {
      const id = crypto.randomUUID();
      const inserted = await insertAttempt(client, { id, rootId, ownerId: identity.userId, courseId, courseVersion, planRevisionId, snapshot });
      if (!inserted) throw new Error('planting failed');
      return id;
    } finally {
      await client.release();
    }
  }

  it('grades a disclosed partial-credit rubric exactly at the declared hundredths scale with pre-answer disclosure and the honest 79.99% boundary', async () => {
    const a = await actor('partial-credit-happy');
    await grant(a);
    const study = await confirmedStudy(a);
    const course = await generateCourse(a, study.rootId, study.revision);
    const ready = course.course;

    const attemptId = await plantOpenAttempt(a, study.rootId, ready.courseId, ready.version, study.planRevisionId, buildPartialCreditSnapshot(ready.objectives));

    // The active state serves the fixture's OWN descriptor: declared hundredths
    // scale, the default override contract, and the per-item disclosed rubric —
    // all BEFORE any answer is submitted. No answer key anywhere.
    const active = await getAssessment(a, study.rootId);
    expect(active.state).toBe('active');
    expect(active.test).toMatchObject({ testId: 'required-test-partial-credit', passMarkPercent: 80, pointsScale: 100, passMarkOverride: { source: 'default', value: 80 }, itemCount: 2, itemPoints: [600000, 400000], totalPoints: 1000000 });
    expect(active.test!.items[0]).toMatchObject({ position: 1, points: 600000, partialCredit: null });
    expect(active.test!.items[1]).toMatchObject({ position: 2, points: 400000, partialCredit: { credits: { c: 199900 } } });
    expect(active.test!.items[1].partialCredit!.disclosure).toContain('1999.00 of 4000.00 points');
    if (!active.attempt || 'gradedAt' in active.attempt) throw new Error('expected an active attempt view');
    expect(active.attempt.items).toHaveLength(2);
    const activeSerialized = JSON.stringify(active);
    expect(activeSerialized).not.toContain('"answerId"');
    expect(activeSerialized).not.toContain('"correctChoiceId"');

    // A repeat start returns the planted open attempt as-is (one open attempt
    // per root) — with ITS OWN pin.
    const reoffered = await startTest(a, study.rootId, { ...command(study.revision) });
    expect(reoffered.operationId).toBe(attemptId);
    expect(reoffered.planRevisionId).toBe(study.planRevisionId);

    // Answer: correct on the full-credit item, the DECLARED partly-correct
    // choice on the rubric item — 600000 + 199900 = 799900/1000000 = 79.99%,
    // honestly below the 80% mark.
    const stored = await snapshotOf(attemptId);
    const credited = Object.keys(stored.items[1].partialCredit!.credits)[0]!;
    const submitCommand = { ...command(study.revision), attemptId, answers: [{ position: 1, choiceId: stored.items[0].answerId }, { position: 2, choiceId: credited }] };
    const graded = await submitAttempt(a, study.rootId, attemptId, submitCommand);
    expect(graded.state).toBe('graded');
    expect(graded.gradeKind).toBe('final');
    expect(graded.pointsScale).toBe(100);
    expect(graded.passMarkOverride).toEqual({ source: 'default', value: 80 });
    expect(graded.earnedPoints).toBe(799900);
    expect(graded.totalPoints).toBe(1000000);
    expect(graded.passed).toBe(false);
    expect(graded.displayPercent).toBe('79.99%');
    expect(graded.verdict).toBe('79.99% — Not passed (mark is 80%)');
    // Per-item reveal: the rubric item earned EXACTLY its declared credit.
    expect(graded.items[0]).toMatchObject({ earned: 600000, correctChoiceId: stored.items[0].answerId });
    expect(graded.items[1]).toMatchObject({ earned: 199900, chosenChoiceId: credited, correctChoiceId: stored.items[1].answerId });

    // Exactly-once: same commandKey replays the identical result; a NEW
    // commandKey on the graded attempt conflicts.
    expect(await submitAttempt(a, study.rootId, attemptId, submitCommand)).toEqual(graded);
    await expect(submitAttempt(a, study.rootId, attemptId, { ...command(study.revision), attemptId, answers: submitCommand.answers })).rejects.toMatchObject({ code: 'CONFLICT' });

    // The failed grade ledgered exactly the rubric item's failed group under
    // its own snapshot — the same machinery, now carrying scaled integers.
    const ledger = await database().query<{ objective_index: number; initial_earned: number; initial_total: number; status: string }>(
      'SELECT objective_index,initial_earned,initial_total,status FROM app.recovery_target WHERE root_attempt_id=$1 ORDER BY objective_index',
      [attemptId],
    );
    expect(ledger.rows).toEqual([{ objective_index: 1, initial_earned: 199900, initial_total: 400000, status: 'open' }]);
    const served = await getAssessment(a, study.rootId);
    expect(served.recovery!.requirementSatisfied).toBe(false);
    expect(served.recovery!.targets[0]).toMatchObject({ objectiveIndex: 1, initialEarned: 199900, initialTotal: 400000, pointsScale: 100, initialDisplayPercent: '50.0%' });

    // The synthetic retest bank mirrors the ROOT bank only: a fixture attempt
    // cannot open the retest chain — rejected, never repaired.
    await expect(startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // The submit receipt stays content-free.
    const receipts = await database().query<{ result: unknown }>("SELECT result FROM app.command_receipt WHERE root_id=$1 AND action='submit-test'", [study.rootId]);
    expect(receipts.rows).toHaveLength(1);
    for (const { result } of receipts.rows) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('answer');
      expect(serialized).not.toContain('choiceId');
      expect(serialized).not.toContain('earnedPoints');
      expect(serialized).not.toContain('passed');
    }
  });

  it('pins a carried instructor override: the running attempt grades at ITS snapshotted mark while the next attempt carries the current default policy', async () => {
    const a = await actor('override-pinned');
    await grant(a);
    const study = await confirmedStudy(a);
    const course = await generateCourse(a, study.rootId, study.revision);
    const ready = course.course;
    const recordedAt = new Date('2026-10-28T10:00:00Z').toISOString();

    // The attempt opens under a carried instructor override of 90 — snapshotted
    // at start like every policy.
    const attemptId = await plantOpenAttempt(a, study.rootId, ready.courseId, ready.version, study.planRevisionId, buildSnapshot(ready.objectives, { source: 'instructor', value: 90, recordedAt }));

    // Disclosure shows the carried override BEFORE any answer.
    const active = await getAssessment(a, study.rootId);
    expect(active.state).toBe('active');
    expect(active.test).toMatchObject({ passMarkPercent: 90, pointsScale: 1, passMarkOverride: { source: 'instructor', value: 90, recordedAt } });

    // The "policy edit": after the attempt started, the course policy the NEXT
    // build would snapshot reverts to the personal-study default (80). The
    // running attempt still grades on ITS pinned snapshot: correct on items
    // 1, 2, 3 and 5, wrong on item 4 earns 8001/10000 = 80.01% — a pass under
    // 80, honestly NOT passed under the pinned 90.
    const stored = await snapshotOf(attemptId);
    const wrongFourth = stored.items[3].choices.find(choice => choice.id !== stored.items[3].answerId)!.id;
    const answers = stored.items.map(item => ({ position: item.position, choiceId: item.position === 4 ? wrongFourth : item.answerId }));
    const graded = await submitAttempt(a, study.rootId, attemptId, { ...command(study.revision), attemptId, answers });
    expect(graded.earnedPoints).toBe(8001);
    expect(graded.passed).toBe(false);
    expect(graded.displayPercent).toBe('80.0%');
    expect(graded.verdict).toBe('80.0% — Not passed (mark is 90%)');
    expect(graded.gradeKind).toBe('final');
    const rowBefore = await database().query('SELECT * FROM app.test_attempt WHERE id=$1', [attemptId]);
    const bytesBefore = JSON.stringify(rowBefore.rows[0]);

    // The NEXT attempt snapshots the CURRENT policy: the default 80 with the
    // default contract — the same answers now honestly pass.
    const next = await startTest(a, study.rootId, { ...command(study.revision) });
    expect(next.operationId).not.toBe(attemptId);
    const nextSnapshot = await snapshotOf(next.operationId);
    expect(nextSnapshot.passMarkPercent).toBe(80);
    expect(nextSnapshot.passMarkOverride).toEqual({ source: 'default', value: 80 });
    const passed = await submitAttempt(a, study.rootId, next.operationId, { ...command(study.revision), attemptId: next.operationId, answers: nextSnapshot.items.map(item => ({ position: item.position, choiceId: item.position === 4 ? wrongFourth : item.answerId })) });
    expect(passed.passed).toBe(true);
    expect(passed.verdict).toBe('80.0% — Pass (mark is 80%)');

    // Completion follows only the final pass; the mid-attempt policy move
    // never revoked or rewrote anything — the failed override row is
    // byte-identical and both attempts stay listed on their own pins.
    for (const item of ready.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId: ready.courseId, itemId: item.id });
    const completed = await getAssessment(a, study.rootId);
    expect(completed.node).toBe('completed');
    // Story 4: the pass-first ordering — the award could not land at the
    // passing submit (items were not done yet); it landed at the LAST
    // markItemDone, the completing contributing verb.
    expect(completed.currentAward).toMatchObject({ kind: 'mini-course', courseVersion: ready.version });
    expect(completed.attempts.map(attempt => [attempt.pointsScale, attempt.passed])).toEqual([[1, true], [1, false]]);
    const rowAfter = await database().query('SELECT * FROM app.test_attempt WHERE id=$1', [attemptId]);
    expect(JSON.stringify(rowAfter.rows[0])).toBe(bytesBefore);
  });
});

// ---------------------------------------------------------------------------
// Story 4 — the monotonic completion-award layer over the REAL verbs: exact-
// once across duplicate triggers and both item/test orderings, byte-stability
// through later state changes (a failed retake, supersession), synthetic
// parent manifests (required children gate, optional never block), and the
// explicit informed version switch (disclosure before move, exact
// acknowledgment, no award erased).
// ---------------------------------------------------------------------------

describe('epic-3 story-4: monotonic completion awards', () => {
  it('awards exactly once per release across duplicate triggers and stays byte-identical through a later failed retake and supersession', async () => {
    const a = await actor('award-monotonic');
    await grant(a);
    const study = await confirmedStudy(a);
    const course = await generateCourse(a, study.rootId, study.revision);
    const courseId = course.course.courseId;
    const firstItemId = course.course.items.find(item => item.required)!.id;

    // Items first, then the pass: the award lands at the passing submit.
    for (const item of course.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId, itemId: item.id });
    const noPassYet = await getAssessment(a, study.rootId);
    expect(noPassYet.node).toBe('in-progress'); // items done, no satisfied test
    expect(noPassYet.currentAward).toBeNull();
    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    const snapshot = await snapshotOf(started.operationId);
    await submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: answersFrom(snapshot) });
    const awarded = await getAssessment(a, study.rootId);
    expect(awarded.node).toBe('completed');
    expect(awarded.currentAward).toMatchObject({ kind: 'mini-course', courseId, courseVersion: 1 });
    const awardRow = await database().query('SELECT * FROM app.completion_award WHERE root_id=$1', [study.rootId]);
    expect(awardRow.rows).toHaveLength(1);
    const awardBytes = JSON.stringify(awardRow.rows[0]);

    // Duplicate triggers insert nothing new: a repeated markItemDone under a
    // FRESH command key (row no-op, evaluation idempotent), the exported hook
    // standalone, and plain reads.
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId, itemId: firstItemId });
    await recordCompletionIfEarned(a, study.rootId, courseId);
    await getAssessment(a, study.rootId);
    const afterDuplicates = await database().query('SELECT * FROM app.completion_award WHERE root_id=$1', [study.rootId]);
    expect(afterDuplicates.rows).toHaveLength(1);
    expect(JSON.stringify(afterDuplicates.rows[0])).toBe(awardBytes);

    // A later FAILED retake on the same release never revokes or re-derives
    // the earned award — the node stays Completed (monotonic), the row is
    // byte-identical, and the new failure still ledgers its own chain.
    const retake = await startTest(a, study.rootId, { ...command(study.revision) });
    const retakeSnapshot = await snapshotOf(retake.operationId);
    const failed = await submitAttempt(a, study.rootId, retake.operationId, { ...command(study.revision), attemptId: retake.operationId, answers: answersFrom(retakeSnapshot, [1, 3, 5]) });
    expect(failed.passed).toBe(false);
    const afterFailRetake = await getAssessment(a, study.rootId);
    expect(afterFailRetake.node).toBe('completed'); // the award decides, not the latest attempt
    expect(afterFailRetake.attempts.map(attempt => attempt.passed)).toEqual([false, true]);
    const awardAfterFail = await database().query('SELECT * FROM app.completion_award WHERE root_id=$1', [study.rootId]);
    expect(JSON.stringify(awardAfterFail.rows[0])).toBe(awardBytes);

    // Supersession: version 2 becomes current; the v1 award stays intact and
    // listed while the served node honestly reports v2 In progress (its own
    // unawarded condition set).
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...plan, topic: 'Unit testing, award edition' }, extractionId: study.extractionId, selectionId: study.selectionId });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await generateCourse(a, study.rootId, confirmed.revision);
    const superseded = await getAssessment(a, study.rootId);
    expect(superseded.version).toBe(2);
    expect(superseded.node).toBe('in-progress');
    expect(superseded.currentAward).toBeNull();
    expect(superseded.awards).toHaveLength(1); // the v1 award stays listed
    expect(superseded.awards[0]).toMatchObject({ kind: 'mini-course', courseVersion: 1 });
    expect(superseded.versions).toEqual([1, 2]);
    const awardFinal = await database().query('SELECT * FROM app.completion_award WHERE root_id=$1', [study.rootId]);
    expect(JSON.stringify(awardFinal.rows[0])).toBe(awardBytes);
  });

  it('evaluates synthetic parent manifests: every required child awarded, optional children never block, one unawarded required child blocks', async () => {
    const a = await actor('award-parent');
    await grant(a);
    // Study A: complete it (items done + pass) so its release award exists.
    const studyA = await confirmedStudy(a, { ...plan, topic: 'Parent child A' });
    const courseA = await generateCourse(a, studyA.rootId, studyA.revision);
    for (const item of courseA.course.items.filter(item => item.required))
      await markItemDone(a, studyA.rootId, { ...command(studyA.revision), courseId: courseA.course.courseId, itemId: item.id });
    const attemptA = await startTest(a, studyA.rootId, { ...command(studyA.revision) });
    const snapshotA = await snapshotOf(attemptA.operationId);
    await submitAttempt(a, studyA.rootId, attemptA.operationId, { ...command(studyA.revision), attemptId: attemptA.operationId, answers: answersFrom(snapshotA) });

    // Study B: generated but NOT completed yet (the required item is undone).
    const studyB = await confirmedStudy(a, { ...plan, topic: 'Parent child B' });
    const courseB = await generateCourse(a, studyB.rootId, studyB.revision);

    // Study C: generated, never completed — the optional child.
    const studyC = await confirmedStudy(a, { ...plan, topic: 'Parent optional child C' });
    const courseC = await generateCourse(a, studyC.rootId, studyC.revision);

    // Plant the parent manifests through the module's own writer (the 3.3
    // planted-fixture precedent): AB requires both A and B; AC requires A
    // with C optional; BD requires B and a never-completed study D.
    const manifestAb = crypto.randomUUID();
    const manifestAc = crypto.randomUUID();
    const manifestBd = crypto.randomUUID();
    const client = await database().connect();
    try {
      const plant = (manifestId: string, children: Array<{ courseId: string; required: boolean }>) =>
        insertParentManifest(client, { id: crypto.randomUUID(), manifestId, ownerId: a.userId, rootId: studyA.rootId, manifest: { schemaVersion: 1, children } });
      await plant(manifestAb, [{ courseId: courseA.course.courseId, required: true }, { courseId: courseB.course.courseId, required: true }]);
      await plant(manifestAc, [{ courseId: courseA.course.courseId, required: true }, { courseId: courseC.course.courseId, required: false }]);
      const studyD = await confirmedStudy(a, { ...plan, topic: 'Parent blocked child D' });
      const courseD = await generateCourse(a, studyD.rootId, studyD.revision);
      await plant(manifestBd, [{ courseId: courseB.course.courseId, required: true }, { courseId: courseD.course.courseId, required: true }]);
      // A duplicate plant of the same manifest identity is a structural no-op.
      expect(await plant(manifestAb, [{ courseId: courseA.course.courseId, required: true }, { courseId: courseB.course.courseId, required: true }])).toBe(false);
    } finally {
      await client.release();
    }

    // Parent evaluation runs at each contributing verb of a REQUIRED child:
    // a duplicate mark on A (already awarded) evaluates AC — A required, C
    // optional and unawarded — so the AC parent awards; AB stays pending (B
    // unawarded) and BD stays pending.
    await markItemDone(a, studyA.rootId, { ...command(studyA.revision), courseId: courseA.course.courseId, itemId: courseA.course.items.find(item => item.required)!.id });
    const parentRowsMid = await database().query<{ manifest_id: string; awarded_at: Date | null }>(
      'SELECT manifest_id,awarded_at FROM app.completion_award WHERE kind=$1 AND manifest_id=ANY($2::uuid[]) ORDER BY manifest_id',
      ['parent-path', [manifestAb, manifestAc, manifestBd]],
    );
    const byManifest = new Map(parentRowsMid.rows.map(row => [row.manifest_id, row.awarded_at]));
    expect(byManifest.get(manifestAb)).toBeNull();
    expect(byManifest.get(manifestBd)).toBeNull();
    expect(byManifest.get(manifestAc)).not.toBeNull(); // optional C never blocked

    // Completing B (its own contributing verbs) awards B and, in the SAME
    // transaction, the AB parent — exactly once; a repeat trigger changes
    // nothing.
    for (const item of courseB.course.items.filter(item => item.required))
      await markItemDone(a, studyB.rootId, { ...command(studyB.revision), courseId: courseB.course.courseId, itemId: item.id });
    const attemptB = await startTest(a, studyB.rootId, { ...command(studyB.revision) });
    const snapshotB = await snapshotOf(attemptB.operationId);
    await submitAttempt(a, studyB.rootId, attemptB.operationId, { ...command(studyB.revision), attemptId: attemptB.operationId, answers: answersFrom(snapshotB) });
    const parentRows = await database().query<{ manifest_id: string; awarded_at: Date | null }>(
      'SELECT manifest_id,awarded_at FROM app.completion_award WHERE kind=$1 AND manifest_id=ANY($2::uuid[]) ORDER BY manifest_id',
      ['parent-path', [manifestAb, manifestAc, manifestBd]],
    );
    const after = new Map(parentRows.rows.map(row => [row.manifest_id, row.awarded_at]));
    expect(after.get(manifestAb)).not.toBeNull(); // B's completing verb awarded it
    expect(after.get(manifestBd)).toBeNull(); // D still unawarded — required child blocks
    expect(after.get(manifestAc)).not.toBeNull();
    // A duplicate trigger on B leaves the parent award byte-identical.
    const parentFull = await database().query('SELECT * FROM app.completion_award WHERE kind=$1 AND manifest_id=$2', ['parent-path', manifestAb]);
    const parentBytes = JSON.stringify(parentFull.rows[0]);
    await markItemDone(a, studyB.rootId, { ...command(studyB.revision), courseId: courseB.course.courseId, itemId: courseB.course.items.find(item => item.required)!.id });
    const parentAgain = await database().query('SELECT * FROM app.completion_award WHERE kind=$1 AND manifest_id=$2', ['parent-path', manifestAb]);
    expect(JSON.stringify(parentAgain.rows[0])).toBe(parentBytes);
    expect(parentAgain.rows).toHaveLength(1);
  });

  it('switches versions only through the informed flow: disclosure first, exact acknowledgment, prior awards never erased', async () => {
    const a = await actor('award-switch');
    await grant(a);
    const study = await confirmedStudy(a);
    const v1 = await generateCourse(a, study.rootId, study.revision);
    const courseIdV1 = v1.course.courseId;
    for (const item of v1.course.items.filter(item => item.required))
      await markItemDone(a, study.rootId, { ...command(study.revision), courseId: courseIdV1, itemId: item.id });
    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    const snapshot = await snapshotOf(started.operationId);
    await submitAttempt(a, study.rootId, started.operationId, { ...command(study.revision), attemptId: started.operationId, answers: answersFrom(snapshot) });
    const completedOnV1 = await getAssessment(a, study.rootId);
    expect(completedOnV1.node).toBe('completed');
    expect(completedOnV1.version).toBe(1);

    // Regenerate with changed required work: a second lesson (a NEW required
    // item) and changed outcomes (a changed required test).
    const secondPlan: Plan = {
      ...plan,
      topic: 'Unit testing, switch edition',
      outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports', 'Recover from a failed test'],
      miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is', 'Judging coverage reports'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
    };
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: secondPlan, extractionId: study.extractionId, selectionId: study.selectionId });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    const v2 = await generateCourse(a, study.rootId, confirmed.revision);
    // The changed required work exists on v2: two required readings (the
    // lesson-2 item is NEW relative to v1) and four objectives.
    expect(v2.course.items.filter(item => item.required).map(item => item.id)).toEqual(['lesson:1:reading', 'lesson:2:reading']);
    expect(v2.course.objectives).toHaveLength(4);
    const onV2 = await getAssessment(a, study.rootId);
    expect(onV2.version).toBe(2);
    expect(onV2.node).toBe('in-progress'); // v2 has its own unawarded condition set
    expect(onV2.awards).toHaveLength(1); // the v1 award stays listed
    expect(onV2.versions).toEqual([1, 2]);

    // The disclosure BEFORE any move: from v2 to v1 names the changed
    // required work exactly — the v2-only lesson-2 reading is REMOVED work
    // and the required test changed with the objectives.
    const disclosure = await getSwitchDisclosure(a, study.rootId, String(1));
    expect(disclosure.from).toMatchObject({ version: 2 });
    expect(disclosure.to).toMatchObject({ version: 1, courseId: courseIdV1 });
    expect(disclosure.removedRequiredItems.map(item => item.id)).toEqual(['lesson:2:reading']);
    expect(disclosure.addedRequiredItems).toEqual([]);
    expect(disclosure.requiredTestChanged).toBe(true);

    // Unconfirmed and stale switches deny per taxonomy: a wrong acknowledgment
    // set, a stale expectedRevision, a foreign course, a cross-owner verb and
    // malformed bodies.
    const correctAcknowledgment = {
      addedRequiredItemIds: disclosure.addedRequiredItems.map(item => item.id),
      removedRequiredItemIds: disclosure.removedRequiredItems.map(item => item.id),
      requiredTestChanged: disclosure.requiredTestChanged,
    };
    await expect(switchCourseVersion(a, study.rootId, { ...command(confirmed.revision), courseId: courseIdV1, acknowledged: { ...correctAcknowledgment, requiredTestChanged: false } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(switchCourseVersion(a, study.rootId, { ...command(confirmed.revision + 5), courseId: courseIdV1, acknowledged: correctAcknowledgment })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(switchCourseVersion(a, study.rootId, { ...command(confirmed.revision), courseId: crypto.randomUUID(), acknowledged: correctAcknowledgment })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(switchCourseVersion(a, study.rootId, { schemaVersion: 2, commandKey: crypto.randomUUID(), expectedRevision: confirmed.revision, courseId: courseIdV1, acknowledged: correctAcknowledgment })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const b = await actor('award-switch-b');
    await expect(switchCourseVersion(b, study.rootId, { ...command(confirmed.revision), courseId: courseIdV1, acknowledged: correctAcknowledgment })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getSwitchDisclosure(a, study.rootId)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(getSwitchDisclosure(b, study.rootId, '1')).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await getAssessment(a, study.rootId)).version).toBe(2); // nothing moved yet

    // The confirmed switch moves the studied release back to v1: the node
    // reads Completed FROM the v1 award, nothing was erased, and a replay of
    // the same command returns the identical receipt.
    const switchCommand = { ...command(confirmed.revision), courseId: courseIdV1, acknowledged: correctAcknowledgment };
    const switched = await switchCourseVersion(a, study.rootId, switchCommand);
    expect(switched).toMatchObject({ state: 'switched', courseId: courseIdV1, version: 1 });
    expect(await switchCourseVersion(a, study.rootId, switchCommand)).toEqual(switched);
    const backOnV1 = await getAssessment(a, study.rootId);
    expect(backOnV1.version).toBe(1);
    expect(backOnV1.node).toBe('completed');
    expect(backOnV1.currentAward).toMatchObject({ courseId: courseIdV1, courseVersion: 1 });
    expect(backOnV1.awards).toHaveLength(1);
    expect((await database().query('SELECT count(*)::int AS count FROM app.completion_award WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(1);

    // A new attempt on the studied v1 pins v1 again (the pointer steers the
    // assessment surface), and switching forward to v2 re-discloses honestly.
    const disclosureForward = await getSwitchDisclosure(a, study.rootId, String(2));
    expect(disclosureForward.from).toMatchObject({ version: 1 });
    expect(disclosureForward.to).toMatchObject({ version: 2 });
    expect(disclosureForward.addedRequiredItems.map(item => item.id)).toEqual(['lesson:2:reading']);
    expect(disclosureForward.removedRequiredItems).toEqual([]);
    expect(disclosureForward.requiredTestChanged).toBe(true);
    const forwardCommand = {
      ...command(confirmed.revision),
      courseId: disclosureForward.to.courseId,
      acknowledged: {
        addedRequiredItemIds: disclosureForward.addedRequiredItems.map(item => item.id),
        removedRequiredItemIds: disclosureForward.removedRequiredItems.map(item => item.id),
        requiredTestChanged: disclosureForward.requiredTestChanged,
      },
    };
    await switchCourseVersion(a, study.rootId, forwardCommand);
    const backOnV2 = await getAssessment(a, study.rootId);
    expect(backOnV2.version).toBe(2);
    expect(backOnV2.node).toBe('in-progress');
    expect(backOnV2.awards).toHaveLength(1); // the v1 award survives every move
    const pinnedToStudied = await startTest(a, study.rootId, { ...command(confirmed.revision) });
    const pinnedAttempt = await database().query<{ course_version: number }>('SELECT course_version FROM app.test_attempt WHERE id=$1', [pinnedToStudied.operationId]);
    expect(pinnedAttempt.rows[0].course_version).toBe(2); // the pointer steers new attempts to the studied release
  });
});
