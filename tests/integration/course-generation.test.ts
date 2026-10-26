import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide, withdraw } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { removeRoot, personalRemoval } from '../../src/modules/lifecycle-platform/service';
import { requestCourseGeneration, getCourse, submitRecall, requestSupplements, getSupplements } from '../../src/modules/course-generation/service';
import { runCourseGeneration, runSupplementFetch } from '../../src/modules/course-generation/worker';
import { createFixtureFetchPort } from '../../src/modules/course-generation/supplements';
import type { BoundedFetchPort, FetchDenyReason } from '../../src/adapters/source-fetch';
import { listExports } from '../../src/modules/setup-export/service';
import { captureManifest } from '../../src/modules/setup-export/manifest';
import { transaction, database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { CourseJob, SupplementJob } from '../../src/contracts/courses';
import type { TextCompletionPort, TextCompletionResult } from '../../src/contracts/ai-provider';

// LOCAL SYNTHETIC coverage of the epic-2 S1 tracer: confirmed plan → generated
// course through the SAME admission/settle machinery, one restart-safe job,
// versioned lineage, server-side answer withholding and epic-1 lifecycle
// purge. The default processor is the local synthetic fixture — zero network.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

const plan: Plan = {
  topic: 'Unit testing fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const textA = 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.';
const textB = 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.';
// The synthetic fixture's canonical recall answer is the first sentence of
// source 0 — deterministic, so withholding can be asserted against it.
const canonicalAnswer = 'Unit testing checks a single unit of behavior.';
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

const portOf = (result: TextCompletionResult): () => TextCompletionPort => {
  const port: TextCompletionPort = { complete: async () => result };
  return () => port;
};
const garbagePort = portOf({ ok: true, text: 'Trust me, a great lesson follows.', provenance: { requestedModel: 'x', returnedModel: 'x-fake' }, usage });

async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({ body: { email: credentials.email, password: credentials.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>('SELECT id FROM auth.session WHERE token=$1', [body.token]);
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}

async function confirmedStudy(identity: Identity, studyPlan: Plan = plan) {
  const slotA = crypto.randomUUID();
  const slotB = crypto.randomUUID();
  const batch = await createBatch(identity, { ...command(), inputs: [
    { slotId: slotA, filename: 'notes.txt', mime: 'text/plain', byteLength: Buffer.byteLength(textA) },
    { slotId: slotB, filename: 'doubles.txt', mime: 'text/plain', byteLength: Buffer.byteLength(textB) },
  ] });
  const uploadA = await uploadSlot(identity, batch.rootId, slotA, command(), new Blob([textA]).stream());
  await runExtraction(uploadA.operationId!);
  const uploadB = await uploadSlot(identity, batch.rootId, slotB, command(), new Blob([textB]).stream());
  await runExtraction(uploadB.operationId!);
  const preview = await getBatch(identity, batch.rootId);
  const slots = preview.slots.filter(item => item.slotId === slotA || item.slotId === slotB);
  if (slots.length !== 2 || slots.some(item => !item.extractionId)) throw new Error('fixture setup failed');
  await acknowledge(identity, batch.rootId, { ...command(preview.revision), selected: slots.map(item => ({ slotId: item.slotId, extractionId: item.extractionId!, acknowledged: true as const })), excluded: [] });
  const acknowledged = await getBatch(identity, batch.rootId);
  const saved = await savePlan(identity, batch.rootId, { ...command(acknowledged.revision), plan: studyPlan, extractionId: acknowledged.selection!.sources[0].extractionId, selectionId: acknowledged.selection!.id });
  await confirmPlan(identity, batch.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
  const confirmed = await getBatch(identity, batch.rootId);
  return { ...confirmed, planRevisionId: saved.planRevisionId!, extractionIds: acknowledged.selection!.sources.map(source => source.extractionId), selection: acknowledged.selection };
}

async function jobOf(identity: Identity, rootId: string): Promise<CourseJob> {
  const row = await database().query<{ id: string; root_id: string; admission_id: string }>(
    'SELECT id,root_id,admission_id FROM app.generated_course WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at DESC LIMIT 1',
    [identity.userId, rootId],
  );
  if (!row.rows[0]) throw new Error('no course request row');
  return { schemaVersion: 1, requestId: row.rows[0].id, admissionId: row.rows[0].admission_id, rootId: row.rows[0].root_id, ownerId: identity.userId, sessionId: identity.sessionId };
}

async function courseRowOf(identity: Identity, rootId: string): Promise<{ id: string }> {
  const row = await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE owner_id=$1 AND root_id=$2 AND status='ready' ORDER BY created_at DESC LIMIT 1", [identity.userId, rootId]);
  if (!row.rows[0]) throw new Error('no ready course row');
  return row.rows[0];
}

async function supplementJobOf(identity: Identity, courseId: string): Promise<SupplementJob> {
  const row = await database().query<{ id: string; root_id: string; admission_id: string }>(
    'SELECT id,root_id,admission_id FROM app.supplement_request WHERE owner_id=$1 AND course_id=$2 ORDER BY created_at DESC LIMIT 1',
    [identity.userId, courseId],
  );
  if (!row.rows[0]) throw new Error('no supplement request row');
  return { schemaVersion: 1, requestId: row.rows[0].id, admissionId: row.rows[0].admission_id, courseId, rootId: row.rows[0].root_id, ownerId: identity.userId, sessionId: identity.sessionId };
}

// The processor_configuration table is shared, ordered state (see ai-check's
// note): grant against the current version when it is eligible, otherwise pin
// this file's own clearly-labeled eligible fixture above it.
async function grant(identity: Identity) {
  let disclosure = await getDisclosure(identity);
  if (disclosure.configuration.eligibility !== 'eligible') {
    const max = await database().query<{ max: number }>('SELECT max(version) AS max FROM app.processor_configuration');
    await database().query(
      `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
       VALUES($1,$2,'Synthetic test spy (fixture — not compliant live AI)','Boundary test purpose','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.','eligible',true,20)`,
      [crypto.randomUUID(), max.rows[0].max + 1],
    );
    disclosure = await getDisclosure(identity);
  }
  await decide(identity, { ...command(), configurationVersion: disclosure.configuration.version, decision: 'granted', acknowledgedTerms: true });
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-2 S1: confirmed-plan-to-generated-course tracer', () => {
  it('generates a version-1 course that withholds the recall answer until submission', async () => {
    const a = await actor('course-happy');
    await grant(a);
    const study = await confirmedStudy(a);
    const receipt = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(receipt.state).toBe('pending');
    expect(receipt.planRevisionId).toBe(study.planRevisionId);
    // The default processor is the local synthetic fixture — no injection.
    await runCourseGeneration(await jobOf(a, study.rootId));
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    if (state.state !== 'ready') return;
    const course = state.course;
    expect(course.version).toBe(1);
    expect(course.superseded).toBe(false);
    expect(course.lesson.title).toBe('What a unit test is'); // from the confirmed plan
    expect(course.lesson.sections.length).toBeGreaterThanOrEqual(1);
    expect(course.lesson.sections[0].source.filename).toBe('notes.txt');
    expect(course.lesson.sections[0].source.locator.length).toBeGreaterThanOrEqual(1);
    expect(course.objectives.map(objective => objective.text)).toEqual(plan.outcomes);
    expect(course.model).toContain('local-synthetic');
    expect(course.usage).toEqual(usage);
    // Answer-withholding: no GET payload carries the recall answer — the
    // synthetic fixture teaches the recall's source from the remainder AFTER
    // its opening sentence (the canonical answer), so the answer string, the
    // rationale string and the field keys are all absent.
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(canonicalAnswer);
    expect(serialized).not.toContain('The opening of notes.txt');
    expect(serialized).not.toContain('"answer"');
    expect(serialized).not.toContain('"rationale"');
    expect(Object.keys(course.recall).sort()).toEqual(['objective', 'prompt', 'source']);
    for (const section of course.lesson.sections) {
      expect(Object.keys(section).sort()).toEqual(['source', 'text']);
      expect(section.text).not.toContain(canonicalAnswer);
    }
    // The stored content still carries them (server-side), the view never does.
    const stored = await database().query<{ content: unknown }>("SELECT content FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    expect(JSON.stringify(stored.rows[0].content)).toContain(canonicalAnswer);
    // Recall: submit the canonical answer, receive it back exactly once here.
    const feedback = await submitRecall(a, study.rootId, { ...command(study.revision), attempted: canonicalAnswer });
    expect(feedback.outcome).toBe('correct');
    expect(feedback.answer).toBe(canonicalAnswer);
    expect(feedback.rationale).toContain('notes.txt');
    expect(feedback.source.filename).toBe('notes.txt');
    const wrong = await submitRecall(a, study.rootId, { ...command(study.revision), attempted: 'something else entirely' });
    expect(wrong.outcome).toBe('incorrect');
    // Invalid body → INVALID_INPUT; nothing recorded.
    await expect(submitRecall(a, study.rootId, { ...command(study.revision), attempted: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // One content-free zero-token ledger row with the generation as its only trace.
    const ledger = await database().query<{ count: number; tokens: number }>("SELECT count(*)::int AS count, COALESCE(sum(total_tokens),0)::int AS tokens FROM app.ai_dispatch_ledger WHERE owner_id=$1", [a.userId]);
    expect(ledger.rows[0]).toMatchObject({ count: 1, tokens: 0 });
    // The 'course' lifecycle object exists with the confirmed plan as parent.
    const objects = await database().query<{ kind: string; parents: string[] }>("SELECT kind,parent_ids AS parents FROM app.lifecycle_object WHERE root_id=$1 AND kind='course'", [study.rootId]);
    expect(objects.rows[0]?.parents).toContain(study.planRevisionId);
  });

  it('denies cross-owner, unconfirmed and stale requests with zero persisted effect', async () => {
    const a = await actor('course-denied-a');
    await grant(a);
    const study = await confirmedStudy(a);
    const b = await actor('course-denied-b');
    await grant(b);
    for (const verb of [
      () => requestCourseGeneration(b, study.rootId, { ...command(study.revision) }),
      () => getCourse(b, study.rootId),
      () => submitRecall(b, study.rootId, { ...command(study.revision), attempted: 'x' }),
    ]) await expect(verb()).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Unconfirmed plans never reach admission.
    const fresh = await actor('course-unconfirmed');
    const slotId = crypto.randomUUID();
    const batch = await createBatch(fresh, { ...command(), inputs: [{ slotId, filename: 'x.txt', mime: 'text/plain', byteLength: 8 }] });
    await expect(requestCourseGeneration(fresh, batch.rootId, { ...command() })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Stale expectedRevision conflicts honestly.
    await expect(requestCourseGeneration(a, study.rootId, { ...command(study.revision + 5) })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Recall before any ready course conflicts (confirm + generate first).
    await expect(submitRecall(a, study.rootId, { ...command(study.revision), attempted: 'x' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1', [study.rootId]);
    expect(rows.rows[0].count).toBe(0);
  });

  it('consent not granted blocks generation with no job and no request row', async () => {
    const a = await actor('course-consent-blocked');
    const study = await confirmedStudy(a);
    await expect(requestCourseGeneration(a, study.rootId, { ...command(study.revision) })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1', [a.userId]);
    expect(rows.rows[0].count).toBe(0);
    // After the one re-grant under the current disclosure, generation works.
    await grant(a);
    const receipt = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(receipt.state).toBe('pending');
  });

  it('replays one command, no-ops duplicate delivery and keeps exactly one ready course', async () => {
    const a = await actor('course-replay');
    await grant(a);
    const study = await confirmedStudy(a);
    const envelope = { ...command(study.revision) };
    const first = await requestCourseGeneration(a, study.rootId, envelope);
    expect(await requestCourseGeneration(a, study.rootId, envelope)).toEqual(first); // command replay
    const job = await jobOf(a, study.rootId);
    await runCourseGeneration(job);
    await runCourseGeneration(job); // duplicate delivery: status guard no-ops
    const ready = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    expect(ready.rows[0].count).toBe(1);
    // A repeat command for the same confirmed revision returns the existing course.
    const repeated = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(repeated.state).toBe('ready');
    expect(repeated.operationId).toBe(job.requestId);
    const admissions = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.dispatch_admission WHERE owner_id=$1', [a.userId]);
    expect(admissions.rows[0].count).toBe(1);
    const ledger = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1', [a.userId]);
    expect(ledger.rows[0].count).toBe(1);
  });

  it('fails honestly on invalid processor output and retries via a new command', async () => {
    const a = await actor('course-invalid-output');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId), garbagePort);
    const failed = await getCourse(a, study.rootId);
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'invalid-output' });
    // The admission was not consumed by a rejected parse; a NEW command retries.
    const retried = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(retried.state).toBe('pending');
    await runCourseGeneration(await jobOf(a, study.rootId));
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
  });

  it('discards the result when consent is withdrawn mid-flight', async () => {
    const a = await actor('course-withdrawn');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    const job = await jobOf(a, study.rootId);
    await withdraw(a, command());
    await runCourseGeneration(job);
    const failed = await getCourse(a, study.rootId);
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'rejected-late' });
    const ready = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    expect(ready.rows[0].count).toBe(0);
    const objects = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='course'", [study.rootId]);
    expect(objects.rows[0].count).toBe(0);
  });

  it('re-confirmation regenerates as a new version that supersedes; prior version stays stored', async () => {
    const a = await actor('course-versioning');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    const firstJob = await jobOf(a, study.rootId);
    await runCourseGeneration(firstJob);
    const v1 = await database().query<{ id: string; version: number }>("SELECT id,version FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    expect(v1.rows[0].version).toBe(1);
    // Re-confirm a changed plan on the same study.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...plan, topic: 'Unit testing, deeper' }, selectionId: study.selection!.id, extractionId: study.extractionIds[0] });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    const second = await requestCourseGeneration(a, study.rootId, { ...command(confirmed.revision) });
    expect(second.state).toBe('pending');
    await runCourseGeneration(await jobOf(a, study.rootId));
    const rows = await database().query<{ id: string; version: number; superseded_by: string | null }>("SELECT id,version,superseded_by FROM app.generated_course WHERE root_id=$1 AND status='ready' ORDER BY version", [study.rootId]);
    expect(rows.rows.map(row => row.version)).toEqual([1, 2]);
    expect(rows.rows[0].superseded_by).toBe(rows.rows[1].id);
    expect(rows.rows[1].superseded_by).toBeNull();
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    if (state.state !== 'ready') return;
    expect(state.course.version).toBe(2);
    expect(state.course.superseded).toBe(false);
    // Prior version stays readable through the explicit id/version resolution,
    // with superseded computed for the requested row.
    const byId = await getCourse(a, study.rootId, rows.rows[0].id);
    expect(byId.state).toBe('ready');
    if (byId.state === 'ready') {
      expect(byId.course.version).toBe(1);
      expect(byId.course.superseded).toBe(true);
      expect(byId.course.lesson.title).toBe('What a unit test is');
    }
    const byVersion = await getCourse(a, study.rootId, '1');
    expect(byVersion.state === 'ready' && byVersion.course.courseId).toBe(rows.rows[0].id);
    // A malformed selector is invalid input; a foreign/unknown one denies without a leak.
    await expect(getCourse(a, study.rootId, 'not-a-uuid')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(getCourse(a, study.rootId, crypto.randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getCourse(a, study.rootId, '9')).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('root deletion purges the derivative lineage and a late job no-ops; personal removal purges everything', async () => {
    const a = await actor('course-purge-root');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    const job = await jobOf(a, study.rootId);
    const removed = await removeRoot(a, study.rootId, { ...command(study.revision) });
    expect(removed.state).toBe('pending');
    // The purge removed the pending row; the late delivery finds nothing and
    // stores nothing — no resurrection is possible.
    await runCourseGeneration(job);
    await expect(getCourse(a, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const courses = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1', [study.rootId]);
    expect(courses.rows[0].count).toBe(0);
    const lineage = await database().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app.course_objective o JOIN app.generated_course c ON c.id=o.course_id WHERE c.root_id=$1',
      [study.rootId],
    );
    expect(lineage.rows[0].count).toBe(0);
    const sourcesPurged = await database().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app.course_source s JOIN app.generated_course c ON c.id=s.course_id WHERE c.root_id=$1',
      [study.rootId],
    );
    expect(sourcesPurged.rows[0].count).toBe(0);
    const objects = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='course'", [study.rootId]);
    expect(objects.rows[0].count).toBe(0);
    // Personal removal purges course rows with the owner.
    const b = await actor('course-purge-personal');
    await grant(b);
    const other = await confirmedStudy(b);
    await requestCourseGeneration(b, other.rootId, { ...command(other.revision) });
    await runCourseGeneration(await jobOf(b, other.rootId));
    await personalRemoval(b, { ...command() });
    const remaining = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1', [b.userId]);
    expect(remaining.rows[0].count).toBe(0);
  });

  it('marks a stranded pending row (job expired past the 120-second cap) failed timeout and lets a new command regenerate', async () => {  const a = await actor('course-timeout');
    await grant(a);
    const study = await confirmedStudy(a);
    const first = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(first.state).toBe('pending');
    // Simulate pg-boss expiry: the worker was down past the queue's 120-second
    // expireInSeconds, so the row aged out with no delivery.
    await database().query("UPDATE app.generated_course SET created_at=clock_timestamp()-interval '130 seconds' WHERE id=$1", [first.operationId]);
    const second = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(second.state).toBe('pending');
    expect(second.operationId).not.toBe(first.operationId); // fresh admission, not the dead state
    const stranded = await database().query<{ status: string; failure_code: string }>('SELECT status,failure_code FROM app.generated_course WHERE id=$1', [first.operationId]);
    expect(stranded.rows[0]).toMatchObject({ status: 'failed', failure_code: 'timeout' });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    // A late delivery of the expired job no-ops against the status guard.
    await runCourseGeneration({ schemaVersion: 1, requestId: first.operationId as string, admissionId: (await database().query<{ admission_id: string }>('SELECT admission_id FROM app.generated_course WHERE id=$1', [first.operationId])).rows[0].admission_id, rootId: study.rootId, ownerId: a.userId, sessionId: a.sessionId });
    const ready = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    expect(ready.rows[0].count).toBe(1);
  });

  it('a delivery whose row reached a terminal state mid-flight commits no content, lineage or ledger row', async () => {
    const a = await actor('course-claim-race');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    const job = await jobOf(a, study.rootId);
    // A valid draft whose completion marks the row failed 'timeout' DURING the
    // dispatch — after the worker's phase-1 pending check, before persist.
    const validDraftJson = JSON.stringify({
      sections: [
        { text: 'A unit test isolates one behavior and asserts its outcome.', sourcePosition: 0, locator: 'opening lines' },
        { text: 'A test double stands in for a real dependency during the test.', sourcePosition: 1, locator: 'opening lines' },
      ],
      objectiveIndexes: [0, 1, 2],
      recall: { objectiveIndex: 0, sourcePosition: 0, locator: 'opening lines', prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
    });
    const racing: () => TextCompletionPort = () => ({
      complete: async () => {
        await database().query("UPDATE app.generated_course SET status='failed',failure_code='timeout',settled_at=clock_timestamp() WHERE id=$1 AND status='pending'", [job.requestId]);
        return { ok: true, text: validDraftJson, provenance: { requestedModel: 'race-fixture', returnedModel: 'race-fixture' }, usage };
      },
    });
    await runCourseGeneration(job, racing);
    // The terminal 'failed' state stands; the late persist wrote nothing.
    const row = await database().query<{ status: string; failure_code: string; content: unknown }>('SELECT status,failure_code,content FROM app.generated_course WHERE id=$1', [job.requestId]);
    expect(row.rows[0]).toMatchObject({ status: 'failed', failure_code: 'timeout' });
    expect(row.rows[0].content).toBeNull();
    const objects = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='course'", [study.rootId]);
    expect(objects.rows[0].count).toBe(0);
    const lineage = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_objective o JOIN app.generated_course c ON c.id=o.course_id WHERE c.root_id=$1', [study.rootId]);
    expect(lineage.rows[0].count).toBe(0);
    const ledger = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1', [a.userId]);
    expect(ledger.rows[0].count).toBe(0);
  });

  it('the export surface declares generated-courses as deliberately skipped with its reason', async () => {
    const a = await actor('course-export-skip');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const preview = await listExports(a);
    const category = preview.categories.find(item => item.category === 'generated-courses');
    expect(category).toMatchObject({ available: true, count: null });
    expect(category?.note).toContain('deliberately excluded');
    const manifest = await transaction(client => captureManifest(client, a.userId));
    const skip = manifest.skipped.find(item => item.category === 'generated-courses');
    expect(skip?.reason).toContain('Deliberately excluded');
    expect(skip?.reason).toContain('recall');
    expect(manifest.entries.every(entry => entry.category !== 'generated-courses')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Epic-2 S2: bounded source retrieval and attributed supplementation. The
// default proposal and fetch ports are the deterministic local fixtures —
// zero network egress in every case below; injected fake ports exercise the
// honest failure codes.
// ---------------------------------------------------------------------------

// Gap markers (docs/bounded-source-fetch.md): gap 0 supported, gap 1 a
// conflicting statement about the SECOND upload's own subject, gap 2 an
// unverifiable claim whose passage the fixture source does not contain.
const supplementsPlan: Plan = {
  ...plan,
  missingExplanations: 'Sources do not cover mock frameworks. A conflicting statement about doubles and dependencies appears in public documentation. One unverifiable claim exists about coverage.',
};

const deniedPort = (reason: FetchDenyReason): BoundedFetchPort => ({ fetch: async () => ({ ok: false, code: 'denied', reason, message: 'denied fixture' }) });
const unavailablePort: BoundedFetchPort = { fetch: async () => ({ ok: false, code: 'unavailable', message: 'no admitted live configuration' }) };
const fixturePort = (): BoundedFetchPort => createFixtureFetchPort();

async function supplementedStudy(identity: Identity) {
  await grant(identity);
  const study = await confirmedStudy(identity, supplementsPlan);
  await requestCourseGeneration(identity, study.rootId, { ...command(study.revision) });
  await runCourseGeneration(await jobOf(identity, study.rootId));
  const course = await courseRowOf(identity, study.rootId);
  await requestSupplements(identity, study.rootId, { ...command(study.revision), courseId: course.id });
  return { study, course, job: await supplementJobOf(identity, course.id) };
}

describe('epic-2 S2: bounded source retrieval and attributed supplementation', () => {
  it('resolves every gap to a verified attributed supplement, a side-by-side conflict, or an honest unsupported state', async () => {
    const a = await actor('supplement-happy');
    const { study, course, job } = await supplementedStudy(a);
    await runSupplementFetch(job);
    const state = await getSupplements(a, study.rootId, course.id);
    expect(state.state).toBe('ready');
    expect(state.gaps.map(resolution => resolution.outcome)).toEqual(['supported', 'conflict', 'unsupported']);
    // Supported: identity, location, verified passage, retrieval time, hash.
    const supported = state.gaps[0].supplement!;
    expect(supported.url.startsWith('https://')).toBe(true);
    expect(supported.origin.endsWith('.example.org')).toBe(true);
    expect(supported.passage).toContain('mock frameworks');
    expect(supported.locator).toContain('fetched document');
    expect(supported.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(Number.isNaN(Date.parse(supported.retrievedAt ?? ''))).toBe(false);
    // Conflict: both sources recorded, never resolved.
    const conflict = state.gaps[1].supplement!;
    expect(conflict.passage).toContain('not the case');
    expect(conflict.conflict?.uploadExcerpt).toContain('test double');
    expect(conflict.conflict?.uploadSource).toContain('doubles.txt');
    // Unsupported: no content persisted, only the honest checked record.
    const unsupported = state.gaps[2].supplement!;
    expect(unsupported.passage).toBeNull();
    expect(unsupported.contentHash).toBeNull();
    expect(unsupported.locator).toBeNull();
    expect(unsupported.retrievedAt).not.toBeNull();
    // The stored rows match the CHECK constraints: unsupported rows carry no
    // content; conflict rows carry both sides.
    const rows = await database().query<{ outcome: string; passage: string | null; upload_excerpt: string | null }>(
      'SELECT outcome,passage,upload_excerpt FROM app.course_supplement WHERE course_id=$1 ORDER BY position', [course.id]);
    expect(rows.rows.map(row => row.outcome)).toEqual(['supported', 'conflict', 'unsupported']);
    expect(rows.rows[2].passage).toBeNull();
    expect(rows.rows[1].upload_excerpt).not.toBeNull();
    // No scored/practice semantics ride the payload.
    for (const banned of ['"score"', '"credit"', '"completion"']) expect(JSON.stringify(state)).not.toContain(banned);
    // One 'supplement' lifecycle object parented to the course's own object,
    // and a second zero-token ledger row beside the generation's.
    const object = await database().query<{ kind: string; parents: string[] }>("SELECT kind,parent_ids AS parents FROM app.lifecycle_object WHERE root_id=$1 AND kind='supplement'", [study.rootId]);
    const courseObject = await database().query<{ object_id: string }>('SELECT object_id FROM app.generated_course WHERE id=$1', [course.id]);
    expect(object.rows[0]?.parents).toContain(courseObject.rows[0].object_id);
    const ledger = await database().query<{ count: number; tokens: number }>("SELECT count(*)::int AS count, COALESCE(sum(total_tokens),0)::int AS tokens FROM app.ai_dispatch_ledger WHERE owner_id=$1", [a.userId]);
    expect(ledger.rows[0]).toMatchObject({ count: 2, tokens: 0 });
  });

  it('declined or withdrawn consent performs zero proposal dispatch, zero fetch and no request row', async () => {
    // Withdrawn owner: the terminal withdrawal blocks every later dispatch.
    const w = await actor('supplement-withdrawn-consent');
    const wstudy = await confirmedStudy(w, supplementsPlan);
    await grant(w);
    await requestCourseGeneration(w, wstudy.rootId, { ...command(wstudy.revision) });
    await runCourseGeneration(await jobOf(w, wstudy.rootId));
    const wcourse = await courseRowOf(w, wstudy.rootId);
    await withdraw(w, command());
    await expect(requestSupplements(w, wstudy.rootId, { ...command(wstudy.revision), courseId: wcourse.id })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Declined owner: a ready course exists, but the latest decision under the
    // current disclosure is not granted — the supplement pass is blocked with
    // zero effect (the same state a lapsed v5 grant is in under v6).
    const d = await actor('supplement-declined-consent');
    const dstudy = await confirmedStudy(d, supplementsPlan);
    await grant(d);
    await requestCourseGeneration(d, dstudy.rootId, { ...command(dstudy.revision) });
    await runCourseGeneration(await jobOf(d, dstudy.rootId));
    const dcourse = await courseRowOf(d, dstudy.rootId);
    await decide(d, { ...command(), configurationVersion: (await getDisclosure(d)).configuration.version, decision: 'declined', acknowledgedTerms: true });
    await expect(requestSupplements(d, dstudy.rootId, { ...command(dstudy.revision), courseId: dcourse.id })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.supplement_request WHERE owner_id=ANY($1::uuid[])', [[w.userId, d.userId]]);
    expect(rows.rows[0].count).toBe(0);
  });

  it('fails fetches honestly with content-free codes and retries via a new command', async () => {
    const a = await actor('supplement-fetch-failures');
    const { study, course } = await supplementedStudy(a);
    // A denied fetch fails the request honestly; nothing persists.
    await runSupplementFetch(await supplementJobOf(a, course.id), undefined, () => deniedPort('host'));
    let state = await getSupplements(a, study.rootId, course.id);
    expect(state).toMatchObject({ state: 'failed', failureCode: 'fetch-denied:host' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1', [course.id])).rows[0].count).toBe(0);
    // A new command retries: an unavailable live port reports fetch-unavailable.
    await requestSupplements(a, study.rootId, { ...command(study.revision), courseId: course.id });
    await runSupplementFetch(await supplementJobOf(a, course.id), undefined, () => unavailablePort);
    state = await getSupplements(a, study.rootId, course.id);
    expect(state).toMatchObject({ state: 'failed', failureCode: 'fetch-unavailable' });
    // Retry with the default fixture port settles verified rows.
    await requestSupplements(a, study.rootId, { ...command(study.revision), courseId: course.id });
    await runSupplementFetch(await supplementJobOf(a, course.id), undefined, fixturePort);
    state = await getSupplements(a, study.rootId, course.id);
    expect(state.state).toBe('ready');
    // An invalid proposal output fails honestly without any fetch.
    const b = await actor('supplement-invalid-output');
    const bstudy = await supplementedStudy(b);
    const garbage: () => TextCompletionPort = portOf({ ok: true, text: 'trust me these sources exist', provenance: { requestedModel: 'x', returnedModel: 'x-fake' }, usage });
    await runSupplementFetch(bstudy.job, garbage);
    const failed = await getSupplements(b, bstudy.study.rootId, bstudy.course.id);
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'invalid-output' });
  });

  it('denies cross-owner, ungenerated and unknown-course requests without a leak', async () => {
    const a = await actor('supplement-denials-a');
    const { study, course } = await supplementedStudy(a);
    const b = await actor('supplement-denials-b');
    await grant(b);
    // B on A's root is the standard no-leak denial for both verbs.
    await expect(getSupplements(b, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(requestSupplements(b, study.rootId, { ...command(study.revision), courseId: course.id })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // A's own root with an unknown course id: generate first (CONFLICT).
    await expect(requestSupplements(a, study.rootId, { ...command(study.revision), courseId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'CONFLICT' });
    // A study with no ready course at all.
    const fresh = await actor('supplement-ungenerated');
    await grant(fresh);
    const freshStudy = await confirmedStudy(fresh, supplementsPlan);
    await expect(requestSupplements(fresh, freshStudy.rootId, { ...command(freshStudy.revision), courseId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(getSupplements(fresh, freshStudy.rootId)).rejects.toMatchObject({ code: 'CONFLICT' });
    // A deleted root denies both verbs.
    const gone = await supplementedStudy(a); // same owner, second study
    await removeRoot(a, gone.study.rootId, { ...command(gone.study.revision) });
    await expect(getSupplements(a, gone.study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('replays one command, no-ops duplicate delivery and self-heals a stranded pending row', async () => {
    const a = await actor('supplement-replay');
    const { study, course } = await supplementedStudy(a);
    const envelope = { ...command(study.revision), courseId: course.id };
    const first = await requestSupplements(a, study.rootId, envelope);
    expect(first.state).toBe('pending');
    expect(await requestSupplements(a, study.rootId, envelope)).toEqual(first); // command replay
    const job = await supplementJobOf(a, course.id);
    await runSupplementFetch(job);
    await runSupplementFetch(job); // duplicate delivery: status guard no-ops
    const ready = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.supplement_request WHERE course_id=$1 AND status='ready'", [course.id]);
    expect(ready.rows[0].count).toBe(1);
    // A repeat command for the same course returns the settled pass.
    const repeated = await requestSupplements(a, study.rootId, { ...command(study.revision), courseId: course.id });
    expect(repeated.state).toBe('ready');
    expect(repeated.operationId).toBe(job.requestId);
    // Stranded pending past the 120-second cap: a new command marks it failed
    // timeout and proceeds to a fresh admission.
    const b = await actor('supplement-stranded');
    const bsup = await supplementedStudy(b);
    const stranded = await requestSupplements(b, bsup.study.rootId, { ...command(bsup.study.revision), courseId: bsup.course.id });
    expect(stranded.state).toBe('pending');
    await database().query("UPDATE app.supplement_request SET created_at=clock_timestamp()-interval '130 seconds' WHERE id=$1", [stranded.operationId]);
    const retried = await requestSupplements(b, bsup.study.rootId, { ...command(bsup.study.revision), courseId: bsup.course.id });
    expect(retried.state).toBe('pending');
    expect(retried.operationId).not.toBe(stranded.operationId);
    const healed = await database().query<{ status: string; failure_code: string }>('SELECT status,failure_code FROM app.supplement_request WHERE id=$1', [stranded.operationId]);
    expect(healed.rows[0]).toMatchObject({ status: 'failed', failure_code: 'timeout' });
    await runSupplementFetch(await supplementJobOf(b, bsup.course.id));
    expect((await getSupplements(b, bsup.study.rootId, bsup.course.id)).state).toBe('ready');
  });

  it('discards the result when consent is withdrawn mid-flight', async () => {
    const a = await actor('supplement-withdrawn');
    const { study, course, job } = await supplementedStudy(a);
    await withdraw(a, command());
    await runSupplementFetch(job);
    const failed = await getSupplements(a, study.rootId, course.id);
    expect(failed).toMatchObject({ state: 'failed', failureCode: 'rejected-late' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1', [course.id]);
    expect(rows.rows[0].count).toBe(0);
    const objects = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='supplement'", [study.rootId]);
    expect(objects.rows[0].count).toBe(0);
  });

  it('root deletion purges supplement rows and objects; personal removal purges them with the owner', async () => {
    const a = await actor('supplement-purge-root');
    const { study, course, job } = await supplementedStudy(a);
    await runSupplementFetch(job);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1', [course.id])).rows[0].count).toBe(3);
    await removeRoot(a, study.rootId, { ...command(study.revision) });
    // The late delivery finds nothing: no resurrection.
    await runSupplementFetch(job);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.supplement_request WHERE root_id=$1', [study.rootId])).rows[0].count).toBe(0);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement s JOIN app.supplement_request r ON r.id=s.request_id WHERE r.root_id=$1', [study.rootId])).rows[0].count).toBe(0);
    const objects = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='supplement'", [study.rootId]);
    expect(objects.rows[0].count).toBe(0);
    // The deletion preview counted the supplements as their own category.
    const b = await actor('supplement-purge-personal');
    const bsup = await supplementedStudy(b);
    await runSupplementFetch(bsup.job);
    await personalRemoval(b, { ...command() });
    const remaining = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1', [bsup.course.id]);
    expect(remaining.rows[0].count).toBe(0);
  });

  it('a delivery whose row reached a terminal state mid-flight commits no supplement rows or lifecycle object', async () => {
    const a = await actor('supplement-claim-race');
    const { study, course, job } = await supplementedStudy(a);
    // A fetch port that serves the REAL fixture content but marks the request
    // row failed 'timeout' on the first fetch — after the worker's phase-1
    // pending check, before the persist transaction.
    const fixture = createFixtureFetchPort();
    let marked = false;
    const racingFetch = (): BoundedFetchPort => ({
      fetch: async (target: string) => {
        if (!marked) {
          marked = true;
          await database().query("UPDATE app.supplement_request SET status='failed',failure_code='timeout',settled_at=clock_timestamp() WHERE id=$1 AND status='pending'", [job.requestId]);
        }
        return fixture.fetch(target);
      },
    });
    await runSupplementFetch(job, undefined, racingFetch);
    // The terminal 'failed' state stands; the late persist wrote nothing.
    const state = await getSupplements(a, study.rootId, course.id);
    expect(state).toMatchObject({ state: 'failed', failureCode: 'timeout' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1', [course.id]);
    expect(rows.rows[0].count).toBe(0);
    const objects = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='supplement'", [study.rootId]);
    expect(objects.rows[0].count).toBe(0);
  });

  it('states declared-gap truncation honestly instead of dropping gaps silently', async () => {
    const a = await actor('supplement-gap-truncation');
    await grant(a);
    const nineGaps = Array.from({ length: 9 }, (_, index) => `Declared gap number ${index + 1} is not covered.`).join(' ');
    const study = await confirmedStudy(a, { ...supplementsPlan, missingExplanations: nineGaps });
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const state = await getSupplements(a, study.rootId, course.id);
    expect(state.state).toBe('none');
    expect(state.gapCount).toBe(9);
    expect(state.gaps).toHaveLength(8);
    expect(state.gapsTruncated).toBe(true);
    expect(state.gaps[7].gap.description).toContain('number 8');
    expect(state.gaps.every(resolution => resolution.outcome === 'unaddressed')).toBe(true);
  });

  it('the export surface declares supplements as deliberately skipped with its reason', async () => {
    const a = await actor('supplement-export-skip');
    const { job } = await supplementedStudy(a);
    await runSupplementFetch(job);
    const preview = await listExports(a);
    const category = preview.categories.find(item => item.category === 'supplements');
    expect(category).toMatchObject({ available: true, count: null });
    expect(category?.note).toContain('deliberately excluded');
    const manifest = await transaction(client => captureManifest(client, a.userId));
    const skip = manifest.skipped.find(item => item.category === 'supplements');
    expect(skip?.reason).toContain('Deliberately excluded');
    expect(skip?.reason).toContain('external-source passages');
    expect(manifest.entries.every(entry => entry.category !== 'supplements')).toBe(true);
  });
});
