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
import { getAssessment, startTest, submitAttempt } from '../../src/modules/assessment-progress/service';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AttemptSnapshot } from '../../src/contracts/assessment';

// LOCAL SYNTHETIC coverage of the epic-3 story-1 scored-attempt tracer: one
// required test over a ready generated course — at-start snapshot pinning
// (supersession stability), exactly-once submission (same commandKey replays
// the identical result, a new commandKey on a graded attempt conflicts),
// answer withholding until grading, the honest 79.96% threshold boundary
// driving the DERIVED roadmap node (In progress -> Completed), and the
// denial sweep. Real PostgreSQL; the processor is the local synthetic
// fixture — zero network, and the assessment itself dispatches nothing.

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
      for (const item of active.attempt.items) expect(Object.keys(item).sort()).toEqual(['choices', 'objective', 'points', 'position', 'prompt']);
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
    // No award rows anywhere: the node is derived, not stored.
    expect((await database().query("SELECT to_regclass('app.completion_award') AS table")).rows[0].table).toBeNull();
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
