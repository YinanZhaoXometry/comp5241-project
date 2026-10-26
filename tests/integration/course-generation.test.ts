import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide, withdraw } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { removeRoot, personalRemoval } from '../../src/modules/lifecycle-platform/service';
import { requestCourseGeneration, getCourse, submitRecall } from '../../src/modules/course-generation/service';
import { runCourseGeneration } from '../../src/modules/course-generation/worker';
import { listExports } from '../../src/modules/setup-export/service';
import { captureManifest } from '../../src/modules/setup-export/manifest';
import { transaction, database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { CourseJob } from '../../src/contracts/courses';
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

async function confirmedStudy(identity: Identity) {
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
  const saved = await savePlan(identity, batch.rootId, { ...command(acknowledged.revision), plan, extractionId: acknowledged.selection!.sources[0].extractionId, selectionId: acknowledged.selection!.id });
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

  it('marks a stranded pending row (job expired past the 120-second cap) failed timeout and lets a new command regenerate', async () => {
    const a = await actor('course-timeout');
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
