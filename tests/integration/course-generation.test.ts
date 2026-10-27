import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide, withdraw } from '../../src/modules/processing-consent/service';
import { savePreferences } from '../../src/modules/setup-preferences/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan, listStudies, getStudy } from '../../src/modules/materials-setup/service';
import { removeRoot, personalRemoval } from '../../src/modules/lifecycle-platform/service';
import { previewDerivatives } from '../../src/modules/lifecycle-platform/derivatives';
import { requestCourseGeneration, getCourse, submitRecall, submitPracticeCard, markItemDone, requestSupplements, getSupplements, requestWhyStep, getWhyState } from '../../src/modules/course-generation/service';
import { runCourseGeneration, runSupplementFetch, runWhyStep } from '../../src/modules/course-generation/worker';
import { createFixtureFetchPort } from '../../src/modules/course-generation/supplements';
import { factsIdenticalAcrossTracks, computeFactsDigest } from '../../src/modules/course-generation/adaptation';
import { contentAdaptation, contentFactsDigest, courseContentV1Schema, courseContentV3Schema, lessonFraming, practiceCardsOf, recallOf, storedCourseContent } from '../../src/contracts/courses';
import type { BoundedFetchPort, FetchDenyReason } from '../../src/adapters/source-fetch';
import { listExports } from '../../src/modules/setup-export/service';
import { captureManifest } from '../../src/modules/setup-export/manifest';
import { transaction, database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { CourseJob, SupplementJob, WhyJob, WhyReceipt } from '../../src/contracts/courses';
import type { TextCompletionPort, TextCompletionResult } from '../../src/contracts/ai-provider';

// LOCAL SYNTHETIC coverage of the epic-2 course tracer: confirmed plan →
// generated course through the SAME admission/settle machinery, one
// restart-safe job, versioned lineage, server-side answer withholding and
// epic-1 lifecycle purge. Epic-2 S3 extends the coverage to the full-lesson
// content v2, the legacy v1 serving wrap, explicit content-item tracking and
// the content-free library/heading generated signal. The default processor is
// the local synthetic fixture — zero network.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

const plan: Plan = {
  topic: 'Unit testing fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
// Epic-2 S3: a full multi-lesson confirmed plan — the v2 generation must cover
// every plan lesson in order.
const multiPlan: Plan = {
  ...plan,
  miniCourse: { ...plan.miniCourse, lessons: ['What a unit test is', 'Test doubles in depth', 'Reading coverage honestly'] },
};
const textA = 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.';
const textB = 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.';
// Epic-2 S6: a third source text — a single-lesson study acknowledged with
// three sources carries three lesson sections, the evidence pool that grounds
// why depth 2 (each further piece past the base reading grounds one level).
const textC = 'A third perspective rounds the reading out. Comparison across pieces is the point of arranging them.';
// The synthetic fixture's per-card canonical answers are the opening sentences
// of the sources the cards draw from (round-robin over the plan's outcomes) —
// deterministic, so withholding can be asserted against every card.
const canonicalAnswer = 'Unit testing checks a single unit of behavior.';
const canonicalAnswerB = 'A test double stands in for a dependency.';
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

async function confirmedStudy(identity: Identity, studyPlan: Plan = plan, texts: string[] = [textA, textB]) {
  const names = ['notes.txt', 'doubles.txt', 'third.txt'];
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

async function whyJobOf(identity: Identity, courseId: string, lessonIndex: number, depth: number): Promise<WhyJob> {
  const row = await database().query<{ id: string; root_id: string; admission_id: string }>(
    'SELECT id,root_id,admission_id FROM app.why_explanation WHERE owner_id=$1 AND course_id=$2 AND lesson_index=$3 AND depth=$4 ORDER BY created_at DESC LIMIT 1',
    [identity.userId, courseId, lessonIndex, depth],
  );
  if (!row.rows[0]) throw new Error('no why row');
  return { schemaVersion: 1, requestId: row.rows[0].id, admissionId: row.rows[0].admission_id, courseId, rootId: row.rows[0].root_id, ownerId: identity.userId, sessionId: identity.sessionId, lessonIndex, depth };
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
    expect(course.supersededBy).toBeNull();
    expect(course.lessons).toHaveLength(1);
    expect(course.lessons[0].number).toBe(1);
    expect(course.lessons[0].title).toBe('What a unit test is'); // from the confirmed plan
    expect(course.lessons[0].sections.length).toBeGreaterThanOrEqual(1);
    expect(course.lessons[0].sections[0].source.filename).toBe('notes.txt');
    expect(course.lessons[0].sections[0].source.locator.length).toBeGreaterThanOrEqual(1);
    expect(course.objectives.map(objective => objective.text)).toEqual(plan.outcomes);
    expect(course.model).toContain('local-synthetic');
    expect(course.usage).toEqual(usage);
    // Tracker items: the required lesson reading plus one labeled optional
    // enrichment, none done yet.
    expect(course.items.map(item => item.id)).toEqual(['lesson:1:reading', 'enrichment:1']);
    expect(course.items.map(item => item.required)).toEqual([true, false]);
    expect(course.items.every(item => !item.done && item.doneAt === null)).toBe(true);
    // Answer-withholding: no GET payload carries any card's answer — the
    // synthetic fixture teaches every card's source from the remainder AFTER
    // its opening sentence (that card's canonical answer), so the answer
    // strings, the rationale strings and the field keys are all absent.
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(canonicalAnswer);
    expect(serialized).not.toContain(canonicalAnswerB);
    expect(serialized).not.toContain('The opening of notes.txt');
    expect(serialized).not.toContain('"answer"');
    expect(serialized).not.toContain('"rationale"');
    expect(Object.keys(course.recall).sort()).toEqual(['objective', 'prompt', 'source']);
    // The epic-2 S5 practice set serves one card per objective with prompts
    // and source locations only.
    expect(course.practice.cards.map(card => card.id)).toEqual(['practice:0', 'practice:1', 'practice:2']);
    expect(course.practice.cards.map(card => card.objective)).toEqual(plan.outcomes);
    for (const card of course.practice.cards) expect(Object.keys(card).sort()).toEqual(['id', 'objective', 'prompt', 'source']);
    for (const section of course.lessons[0].sections) {
      expect(Object.keys(section).sort()).toEqual(['source', 'text']);
      expect(section.text).not.toContain(canonicalAnswer);
      expect(section.text).not.toContain(canonicalAnswerB);
    }
    // The stored content still carries the full set (server-side), the view never does.
    const stored = await database().query<{ content: unknown }>("SELECT content FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    const storedCards = practiceCardsOf(storedCourseContent(stored.rows[0].content)!);
    expect(storedCards.map(card => card.answer)).toEqual([canonicalAnswer, canonicalAnswerB, canonicalAnswer]);
    expect(recallOf(storedCourseContent(stored.rows[0].content)!).answer).toBe(canonicalAnswer);
    // Recall: submit the canonical answer, receive it back exactly once here.
    // The 2.1 verb derives from card 0 and by its contract records feedback
    // and a content-free receipt ONLY — NO typed evidence row (evidence kinds
    // are learner-declared and only the practice verb's schema declares one).
    const feedback = await submitRecall(a, study.rootId, { ...command(study.revision), attempted: canonicalAnswer });
    expect(feedback.outcome).toBe('correct');
    expect(feedback.cardId).toBe('practice:0');
    expect(feedback.evidenceKind).toBeUndefined();
    expect(feedback.answer).toBe(canonicalAnswer);
    expect(feedback.rationale).toContain('notes.txt');
    expect(feedback.source.filename).toBe('notes.txt');
    const wrong = await submitRecall(a, study.rootId, { ...command(study.revision), attempted: 'something else entirely' });
    expect(wrong.outcome).toBe('incorrect');
    expect(wrong.evidenceKind).toBeUndefined();
    // The recall verb persisted ZERO evidence rows — typed evidence belongs
    // to the practice verb (covered by the S5 suite below).
    const evidence = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.practice_attempt WHERE owner_id=$1', [a.userId]);
    expect(evidence.rows[0].count).toBe(0);
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
      expect(byId.course.supersededBy).toBe(2);
      expect(byId.course.lessons[0].title).toBe('What a unit test is');
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
    // A valid v4 draft whose completion marks the row failed 'timeout' DURING
    // the dispatch — after the worker's phase-1 pending check, before persist.
    const validDraftJson = JSON.stringify({
      lessons: [{ framing: 'Plain-language walkthrough of the lesson.', sections: [
        { text: 'A unit test isolates one behavior and asserts its outcome.', sourcePosition: 0, locator: 'opening lines' },
        { text: 'A test double stands in for a real dependency during the test.', sourcePosition: 1, locator: 'opening lines' },
      ] }],
      objectiveIndexes: [0, 1, 2],
      cards: [
        { objectiveIndex: 0, sourcePosition: 0, locator: 'opening lines', prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
        { objectiveIndex: 1, sourcePosition: 1, locator: 'opening lines', prompt: 'Name the double.', answer: 'A test double.', rationale: 'Stated in the opening of doubles.txt.' },
        { objectiveIndex: 2, sourcePosition: 0, locator: 'second sentence', prompt: 'State what coverage reports.', answer: 'Executed lines.', rationale: 'Stated in notes.txt.' },
      ],
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
// Epic-2 S3: the full-lesson player shell and content-item tracking —
// multi-lesson content v2, explicit mark-done persistence (idempotent,
// owner/course-version scoped, per-version state), legacy v1 serving through
// the wrap, honest denials and the content-free library generated signal.
// ---------------------------------------------------------------------------

describe('epic-2 S3: player shell content v2 and content-item tracking', () => {
  it('generates the confirmed plan\'s full lesson set in order with tracker items and one optional enrichment', async () => {
    const a = await actor('course-multi-lesson');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    if (state.state !== 'ready') return;
    const course = state.course;
    expect(course.lessons.map(lesson => lesson.number)).toEqual([1, 2, 3]);
    expect(course.lessons.map(lesson => lesson.title)).toEqual(multiPlan.miniCourse.lessons);
    for (const lesson of course.lessons) expect(lesson.sections.length).toBeGreaterThanOrEqual(1);
    expect(course.items.map(item => item.id)).toEqual(['lesson:1:reading', 'lesson:2:reading', 'lesson:3:reading', 'enrichment:1']);
    expect(course.items.filter(item => item.required).map(item => item.lessonNumber)).toEqual([1, 2, 3]);
    const optional = course.items.find(item => !item.required)!;
    expect(optional.title).toBe('Optional enrichment reading');
    expect(optional.text === null || optional.text.length > 0).toBe(true);
    // No dwell/scroll/completion semantics ride the payload anywhere.
    for (const banned of ['"dwell"', '"scroll"', '"visibility"', '"completion"', '"score"', '"credit"']) expect(JSON.stringify(state)).not.toContain(banned);
    // The stored content is v4 with the code-derived adaptation record and
    // every card answer only server-side.
    const stored = await database().query<{ content: { contentVersion?: number; adaptation?: { track: string } } }>("SELECT content FROM app.generated_course WHERE root_id=$1 AND status='ready'", [study.rootId]);
    expect(stored.rows[0].content.contentVersion).toBe(4);
    expect(stored.rows[0].content.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
  });

  it('persists explicit mark-done idempotently, joins it per version and denies honestly', async () => {
    const a = await actor('tracker-happy');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const envelope = { ...command(study.revision), courseId: course.id, itemId: 'lesson:1:reading' };
    const first = await markItemDone(a, study.rootId, envelope);
    expect(first).toMatchObject({ rootId: study.rootId, operationId: course.id, itemId: 'lesson:1:reading', state: 'done' });
    // Command replay: the identical envelope returns the identical receipt.
    expect(await markItemDone(a, study.rootId, envelope)).toEqual(first);
    // Exactly one row (UNIQUE(owner, course, item)).
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id=$1', [course.id]);
    expect(rows.rows[0].count).toBe(1);
    // A second item joins beside the first.
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'lesson:3:reading' });
    const after = await getCourse(a, study.rootId);
    expect(after.state).toBe('ready');
    if (after.state === 'ready') {
      const done = new Map(after.course.items.map(item => [item.id, item.done]));
      expect(done.get('lesson:1:reading')).toBe(true);
      expect(done.get('lesson:2:reading')).toBe(false);
      expect(done.get('lesson:3:reading')).toBe(true);
      expect(done.get('enrichment:1')).toBe(false); // optional: never tracked
    }
    // An unknown item id in this version is a stale-view conflict, not a write.
    await expect(markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'lesson:9:reading' })).rejects.toMatchObject({ code: 'CONFLICT' });
    // The optional enrichment item is never markable.
    await expect(markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'enrichment:1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // A foreign/unknown course id under the owner's own root conflicts.
    await expect(markItemDone(a, study.rootId, { ...command(study.revision), courseId: crypto.randomUUID(), itemId: 'lesson:1:reading' })).rejects.toMatchObject({ code: 'CONFLICT' });
    // A stale expectedRevision conflicts honestly.
    await expect(markItemDone(a, study.rootId, { ...command(study.revision + 5), courseId: course.id, itemId: 'lesson:2:reading' })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Cross-owner: B on A's root is the standard no-leak denial.
    const b = await actor('tracker-cross-owner');
    await grant(b);
    await expect(markItemDone(b, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'lesson:1:reading' })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Nothing but the two explicit rows exist.
    const final = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id=$1', [course.id]);
    expect(final.rows[0].count).toBe(2);
  });

  it('keeps per-version tracker state: regeneration does not inherit marks and the studied version keeps its own', async () => {
    const a = await actor('tracker-versions');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const v1 = await courseRowOf(a, study.rootId);
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: v1.id, itemId: 'lesson:1:reading' });
    // Re-confirm a changed plan and regenerate as version 2.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...multiPlan, topic: 'Unit testing, deeper' }, selectionId: study.selection!.id, extractionId: study.extractionIds[0] });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await requestCourseGeneration(a, study.rootId, { ...command(confirmed.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const current = await getCourse(a, study.rootId);
    expect(current.state).toBe('ready');
    if (current.state === 'ready') {
      expect(current.course.version).toBe(2);
      expect(current.course.superseded).toBe(false);
      expect(current.course.items.every(item => !item.done)).toBe(true); // fresh version, fresh tracker
    }
    // The prior version stays readable with its OWN tracker state.
    const prior = await getCourse(a, study.rootId, v1.id);
    expect(prior.state).toBe('ready');
    if (prior.state === 'ready') {
      expect(prior.course.version).toBe(1);
      expect(prior.course.superseded).toBe(true);
      expect(prior.course.supersededBy).toBe(2);
      expect(prior.course.items.find(item => item.id === 'lesson:1:reading')?.done).toBe(true);
    }
    // And marking on the prior version never bleeds into the current one.
    await markItemDone(a, study.rootId, { ...command(confirmed.revision), courseId: v1.id, itemId: 'lesson:2:reading' });
    const again = await getCourse(a, study.rootId);
    expect(again.state === 'ready' && again.course.items.every(item => !item.done)).toBe(true);
    const priorAgain = await getCourse(a, study.rootId, v1.id);
    expect(priorAgain.state === 'ready' && priorAgain.course.items.find(item => item.id === 'lesson:2:reading')?.done).toBe(true);
  });

  it('serves a stored pre-2.3 v1 course unchanged through the legacy wrap, without rewriting the row', async () => {
    const a = await actor('course-legacy-v1');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const generated = await courseRowOf(a, study.rootId);
    // Simulate a pre-2.3 stored row: replace the settled content with the
    // legacy single-lesson document (exactly the v1 contract shape).
    const legacyContent = {
      lessonTitle: 'What a unit test is',
      sections: [{ text: 'A unit test isolates one behavior and asserts its outcome.', sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }],
      objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
      recall: { objectiveIndex: 0, sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' }, prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
    };
    expect(courseContentV1Schema.safeParse(legacyContent).success).toBe(true);
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [generated.id, legacyContent]);
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    if (state.state === 'ready') {
      expect(state.course.lessons).toHaveLength(1);
      expect(state.course.lessons[0]).toMatchObject({ number: 1, title: 'What a unit test is' });
      expect(state.course.lessons[0].sections[0].source.filename).toBe('notes.txt');
      expect(state.course.items.map(item => item.id)).toEqual(['lesson:1:reading']); // no enrichment invented
      expect(state.course.objectives).toEqual([{ index: 0, text: 'Explain arrange-act-assert' }]);
    }
    // The wrapped row is still markable through the same tracker machinery.
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: generated.id, itemId: 'lesson:1:reading' });
    const marked = await getCourse(a, study.rootId);
    expect(marked.state === 'ready' && marked.course.items[0].done).toBe(true);
    // No regeneration-on-read, no silent rewrite: the stored document keeps
    // its exact legacy shape after serving.
    const stored = await database().query<{ content: { lessonTitle?: string; contentVersion?: number } }>('SELECT content FROM app.generated_course WHERE id=$1', [generated.id]);
    expect(stored.rows[0].content.lessonTitle).toBe('What a unit test is');
    expect(stored.rows[0].content.contentVersion).toBeUndefined();
  });

  it('exposes the content-free course-generated signal for the library line and confirmed heading', async () => {
    const a = await actor('course-generated-signal');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    const before = await listStudies(a);
    expect(before.find(entry => entry.rootId === study.rootId)?.courseGenerated).toBe(false);
    expect((await getStudy(a, study.rootId)).courseGenerated).toBe(false);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const after = await listStudies(a);
    expect(after.find(entry => entry.rootId === study.rootId)?.courseGenerated).toBe(true);
    expect((await getStudy(a, study.rootId)).courseGenerated).toBe(true);
    // A failed generation keeps the honest not-generated signal.
    const failing = await actor('course-generated-signal-failed');
    await grant(failing);
    const failingStudy = await confirmedStudy(failing);
    await requestCourseGeneration(failing, failingStudy.rootId, { ...command(failingStudy.revision) });
    await runCourseGeneration(await jobOf(failing, failingStudy.rootId), garbagePort);
    const failedList = await listStudies(failing);
    expect(failedList.find(entry => entry.rootId === failingStudy.rootId)?.courseGenerated).toBe(false);
  });

  it('root deletion purges tracker rows with the course lineage; personal removal purges them with the owner', async () => {
    const a = await actor('tracker-purge-root');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'lesson:1:reading' });
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'lesson:2:reading' });
    // The deletion preview counts the tracker rows as their own category.
    const preview = await transaction(client => previewDerivatives(client, { ownerId: a.userId, rootIds: [study.rootId], objectIds: [], personal: false }));
    expect(preview.find(category => category.key === 'tracker-state')).toMatchObject({ label: 'Study tracker state', count: 2 });
    await removeRoot(a, study.rootId, { ...command(study.revision) });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id=$1', [course.id]);
    expect(rows.rows[0].count).toBe(0);
    // Personal removal purges tracker rows with the owner.
    const b = await actor('tracker-purge-personal');
    await grant(b);
    const other = await confirmedStudy(b, multiPlan);
    await requestCourseGeneration(b, other.rootId, { ...command(other.revision) });
    await runCourseGeneration(await jobOf(b, other.rootId));
    const otherCourse = await courseRowOf(b, other.rootId);
    await markItemDone(b, other.rootId, { ...command(other.revision), courseId: otherCourse.id, itemId: 'lesson:1:reading' });
    await personalRemoval(b, { ...command() });
    const remaining = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_item_state WHERE owner_id=$1', [b.userId]);
    expect(remaining.rows[0].count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Epic-2 S5: the active recall practice set and typed feedback — one card per
// plan objective, per-card submission with the learner-declared assisted
// flag, typed evidence rows without attempt semantics, fresh retries, replay
// idempotency, per-version sets, legacy one-card serving, and lifecycle
// purge/export honesty.
// ---------------------------------------------------------------------------

describe('epic-2 S5: practice set and typed feedback', () => {
  it('generates the practice set across every objective and withholds every card answer until that card\'s own submission', async () => {
    const a = await actor('practice-set');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    if (state.state !== 'ready') return;
    const course = state.course;
    expect(course.practice.cards).toHaveLength(multiPlan.outcomes.length);
    expect(course.practice.cards.map(card => card.id)).toEqual(['practice:0', 'practice:1', 'practice:2']);
    expect(course.practice.cards.map(card => card.objective)).toEqual(multiPlan.outcomes);
    for (const card of course.practice.cards) expect(Object.keys(card).sort()).toEqual(['id', 'objective', 'prompt', 'source']);
    // Every card's canonical answer (its own source's opening sentence) is
    // absent from the whole GET payload and every served section text.
    const serialized = JSON.stringify(state);
    for (const banned of [canonicalAnswer, canonicalAnswerB, '"answer"', '"rationale"', '"score"', '"credit"', '"completion"']) expect(serialized).not.toContain(banned);
    // Per-card submission releases THAT card's answer with correctness,
    // rationale, source and the declared evidence kind.
    const unaided = await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.courseId, cardId: 'practice:1', attempted: canonicalAnswerB, assisted: false });
    expect(unaided).toMatchObject({ rootId: study.rootId, courseId: course.courseId, cardId: 'practice:1', outcome: 'correct', attempted: canonicalAnswerB, answer: canonicalAnswerB, evidenceKind: 'unaided' });
    expect(unaided.rationale).toContain('doubles.txt');
    expect(unaided.source.filename).toBe('doubles.txt');
    // After card 1's submission the OTHER cards' answers stay withheld: a
    // fresh GET still carries none of them.
    const after = JSON.stringify(await getCourse(a, study.rootId));
    for (const banned of [canonicalAnswer, canonicalAnswerB, '"answer"', '"rationale"']) expect(after).not.toContain(banned);
    // One typed evidence row exists — exactly the submission event above.
    const rows = await database().query<{ card_id: string; outcome: string; evidence_kind: string }>(
      'SELECT card_id,outcome,evidence_kind FROM app.practice_attempt WHERE owner_id=$1', [a.userId],
    );
    expect(rows.rows).toEqual([{ card_id: 'practice:1', outcome: 'correct', evidence_kind: 'unaided' }]);
  });

  it('records one typed evidence row per submission event; retries are fresh rows and replays write nothing new', async () => {
    const a = await actor('practice-evidence');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const envelope = { ...command(study.revision), courseId: course.id, cardId: 'practice:0', attempted: canonicalAnswer, assisted: false };
    const first = await submitPracticeCard(a, study.rootId, envelope);
    expect(first).toMatchObject({ cardId: 'practice:0', outcome: 'correct', evidenceKind: 'unaided' });
    // Command replay: the SAME envelope returns the identical recorded
    // feedback and writes NO second evidence row.
    expect(await submitPracticeCard(a, study.rootId, envelope)).toEqual(first);
    // Assisted practice is learner-declared at submission and recorded as its
    // own evidence kind — never merged with unaided.
    const assisted = await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:1', attempted: 'i peeked at my notes', assisted: true });
    expect(assisted).toMatchObject({ cardId: 'practice:1', outcome: 'incorrect', evidenceKind: 'assisted' });
    // Retry after feedback: a FRESH command lands a FRESH row; the prior rows
    // are untouched and nothing is deduplicated or double-counted.
    const retry = await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:1', attempted: canonicalAnswerB, assisted: true });
    expect(retry).toMatchObject({ cardId: 'practice:1', outcome: 'correct', evidenceKind: 'assisted' });
    const rows = await database().query<{ card_id: string; attempted: string; outcome: string; evidence_kind: string }>(
      'SELECT card_id,attempted,outcome,evidence_kind FROM app.practice_attempt WHERE course_id=$1 ORDER BY submitted_at,id', [course.id],
    );
    expect(rows.rows).toHaveLength(3); // one per event — the replay added none
    expect(rows.rows.map(row => [row.card_id, row.attempted, row.outcome, row.evidence_kind])).toEqual([
      ['practice:0', canonicalAnswer, 'correct', 'unaided'],
      ['practice:1', 'i peeked at my notes', 'incorrect', 'assisted'],
      ['practice:1', canonicalAnswerB, 'correct', 'assisted'],
    ]);
    // The table carries no score, credit, completion, course-attempt or
    // scheduling column at all — only the typed submission event.
    const columns = await database().query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='practice_attempt'",
    );
    expect(columns.rows.map(row => row.column_name).sort()).toEqual(['attempted', 'card_id', 'course_id', 'evidence_kind', 'id', 'outcome', 'owner_id', 'submitted_at']);
  });

  it('keeps per-version practice sets: regeneration supersedes, prior versions keep their cards and evidence', async () => {
    const a = await actor('practice-versions');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const v1 = await courseRowOf(a, study.rootId);
    await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: v1.id, cardId: 'practice:0', attempted: canonicalAnswer, assisted: false });
    // Re-confirm a changed plan and regenerate as version 2.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...multiPlan, topic: 'Unit testing, deeper' }, selectionId: study.selection!.id, extractionId: study.extractionIds[0] });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await requestCourseGeneration(a, study.rootId, { ...command(confirmed.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const current = await getCourse(a, study.rootId);
    expect(current.state === 'ready' && current.course.practice.cards.map(card => card.id)).toEqual(['practice:0', 'practice:1', 'practice:2']);
    // The prior version keeps its OWN set readable, accepts submissions
    // through the same machinery, and its evidence rows stay its own.
    const prior = await getCourse(a, study.rootId, v1.id);
    expect(prior.state === 'ready' && prior.course.practice.cards.map(card => card.id)).toEqual(['practice:0', 'practice:1', 'practice:2']);
    await submitPracticeCard(a, study.rootId, { ...command(confirmed.revision), courseId: v1.id, cardId: 'practice:2', attempted: 'from the studied version', assisted: false });
    const byCourse = await database().query<{ course_id: string; count: number }>(
      'SELECT course_id,count(*)::int AS count FROM app.practice_attempt WHERE owner_id=$1 GROUP BY course_id', [a.userId],
    );
    expect(byCourse.rows.find(row => row.course_id === v1.id)?.count).toBe(2);
    expect(byCourse.rows).toHaveLength(1); // v2 has no evidence yet — fresh set, fresh state
  });

  it('denies cross-owner, unknown-card, stale-revision and invalid submissions without a leak and records nothing', async () => {
    const a = await actor('practice-denied-a');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const b = await actor('practice-denied-b');
    await grant(b);
    await expect(submitPracticeCard(b, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:0', attempted: 'x', assisted: false })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // A card id not part of this course version is a stale-view conflict.
    await expect(submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:7', attempted: 'x', assisted: false })).rejects.toMatchObject({ code: 'CONFLICT' });
    // A foreign/unknown course id under the owner's own root conflicts.
    await expect(submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: crypto.randomUUID(), cardId: 'practice:0', attempted: 'x', assisted: false })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Stale expectedRevision conflicts honestly.
    await expect(submitPracticeCard(a, study.rootId, { ...command(study.revision + 5), courseId: course.id, cardId: 'practice:0', attempted: 'x', assisted: false })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Invalid bodies never record: empty attempt text, missing assisted flag,
    // a malformed card id.
    for (const body of [
      { ...command(study.revision), courseId: course.id, cardId: 'practice:0', attempted: '', assisted: false },
      { ...command(study.revision), courseId: course.id, cardId: 'practice:0', attempted: 'x' },
      { ...command(study.revision), courseId: course.id, cardId: 'not-a-card', attempted: 'x', assisted: true },
    ]) await expect(submitPracticeCard(a, study.rootId, body)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.practice_attempt WHERE owner_id=ANY($1::uuid[])', [[a.userId, b.userId]]);
    expect(rows.rows[0].count).toBe(0);
  });

  it('serves a stored pre-2.5 course unchanged: the single recall is its one-card set view and stays submittable', async () => {
    const a = await actor('practice-legacy');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const generated = await courseRowOf(a, study.rootId);
    // Simulate a stored pre-2.4 v2 row: exactly the v2 contract shape with its
    // single recall and no practice field.
    const v2Content = {
      contentVersion: 2,
      lessons: [{ title: 'What a unit test is', sections: [{ text: 'A unit test isolates one behavior.', sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }], items: [{ id: 'lesson:1:reading', kind: 'reading', required: true, title: 'Read lesson 1: What a unit test is' }] }],
      objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
      recall: { objectiveIndex: 0, sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' }, prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
    };
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [generated.id, v2Content]);
    const state = await getCourse(a, study.rootId);
    expect(state.state === 'ready' && state.course.practice.cards.map(card => card.id)).toEqual(['practice:0']);
    if (state.state !== 'ready') return;
    expect(state.course.practice.cards[0]).toMatchObject({ objective: 'Explain arrange-act-assert', prompt: 'State the three parts of a unit test.' });
    // The legacy card submits through the SAME machinery (one judge, two
    // verbs) and records typed evidence like any v4 card.
    const feedback = await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: generated.id, cardId: 'practice:0', attempted: 'Arrange, act, assert.', assisted: false });
    expect(feedback).toMatchObject({ cardId: 'practice:0', outcome: 'correct', answer: 'Arrange, act, assert.', evidenceKind: 'unaided' });
    // No regeneration-on-read, no silent rewrite: the stored document keeps
    // its exact v2 shape after serving and submitting.
    const stored = await database().query<{ content: { contentVersion?: number } }>('SELECT content FROM app.generated_course WHERE id=$1', [generated.id]);
    expect(stored.rows[0].content.contentVersion).toBe(2);
  });

  it('serves a stored pre-2.5 v3 course unchanged: the single recall is its one-card set view and stays submittable', async () => {
    const a = await actor('practice-legacy-v3');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const generated = await courseRowOf(a, study.rootId);
    // Simulate a stored v3 row exactly as generation emitted it at 1104e95:
    // the full-lesson set with per-lesson TREATMENT framing, the code-derived
    // adaptation record and the factual-core digest over the single recall.
    const v3Lessons = [{
      title: 'What a unit test is',
      framing: '“What a unit test is” is presented directly as your sources state it; no track-specific framing was added.',
      sections: [{ text: 'A unit test isolates one behavior and asserts its outcome.', sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }],
      items: [{ id: 'lesson:1:reading', kind: 'reading' as const, required: true, title: 'Read lesson 1: What a unit test is' }],
    }];
    const v3Objectives = [{ index: 0, text: 'Explain arrange-act-assert' }, { index: 1, text: 'Explain test doubles' }];
    const v3Recall = {
      objectiveIndex: 1,
      sourceRef: { extractionId: study.extractionIds[1], filename: 'doubles.txt', locator: 'opening lines' },
      prompt: 'Name what stands in for a dependency.',
      answer: 'A test double.',
      rationale: 'Stated in the opening of doubles.txt.',
    };
    const v3Content = {
      contentVersion: 3 as const,
      lessons: v3Lessons,
      objectives: v3Objectives,
      recall: v3Recall,
      adaptation: { track: 'neutral' as const, backgroundSummary: '' },
      factsDigest: computeFactsDigest({ lessons: v3Lessons, objectives: v3Objectives, recall: v3Recall }),
    };
    expect(courseContentV3Schema.safeParse(v3Content).success).toBe(true);
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [generated.id, v3Content]);
    const state = await getCourse(a, study.rootId);
    expect(state.state === 'ready' && state.course.practice.cards.map(card => card.id)).toEqual(['practice:1']);
    if (state.state !== 'ready') return;
    // The v3 row serves UNCHANGED through the new practice-set view: framing,
    // adaptation and digest all still surface, and the single recall becomes
    // its one-card set view under its own objective index.
    expect(state.course.practice.cards[0]).toMatchObject({ objective: 'Explain test doubles', prompt: 'Name what stands in for a dependency.' });
    expect(state.course.practice.cards[0].source.filename).toBe('doubles.txt');
    expect(state.course.lessons[0].framing).toContain('no track-specific framing');
    expect(state.course.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
    expect(state.course.factsDigest).toBe(v3Content.factsDigest);
    expect(state.course.recall.objective).toBe('Explain test doubles');
    // A submission against the legacy v3 card works through the SAME
    // machinery and records typed evidence under its derived card id.
    const feedback = await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: generated.id, cardId: 'practice:1', attempted: 'A test double.', assisted: false });
    expect(feedback).toMatchObject({ cardId: 'practice:1', outcome: 'correct', answer: 'A test double.', evidenceKind: 'unaided' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.practice_attempt WHERE course_id=$1 AND card_id=$2', [generated.id, 'practice:1'])).rows[0].count).toBe(1);
    // No regeneration-on-read, no silent rewrite: the stored document keeps
    // its exact v3 shape after serving and submitting.
    const stored = await database().query<{ content: { contentVersion?: number; recall?: unknown } }>('SELECT content FROM app.generated_course WHERE id=$1', [generated.id]);
    expect(stored.rows[0].content.contentVersion).toBe(3);
    expect(stored.rows[0].content.recall).toBeDefined();
  });

  it('root deletion purges practice evidence with the course lineage; personal removal purges it with the owner; export records the honest skip', async () => {
    const a = await actor('practice-purge');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:0', attempted: 'one', assisted: false });
    await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:1', attempted: 'two', assisted: true });
    // The deletion preview counts practice evidence as its own category.
    const preview = await transaction(client => previewDerivatives(client, { ownerId: a.userId, rootIds: [study.rootId], objectIds: [], personal: false }));
    expect(preview.find(category => category.key === 'practice-evidence')).toMatchObject({ label: 'Practice evidence', count: 2 });
    await removeRoot(a, study.rootId, { ...command(study.revision) });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.practice_attempt WHERE course_id=$1', [course.id])).rows[0].count).toBe(0);
    // Personal removal purges practice evidence with the owner.
    const b = await actor('practice-purge-personal');
    await grant(b);
    const other = await confirmedStudy(b, multiPlan);
    await requestCourseGeneration(b, other.rootId, { ...command(other.revision) });
    await runCourseGeneration(await jobOf(b, other.rootId));
    const otherCourse = await courseRowOf(b, other.rootId);
    await submitPracticeCard(b, other.rootId, { ...command(other.revision), courseId: otherCourse.id, cardId: 'practice:0', attempted: 'one', assisted: false });
    await personalRemoval(b, { ...command() });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.practice_attempt WHERE owner_id=$1', [b.userId])).rows[0].count).toBe(0);
    // The export surface lists practice-evidence as deliberately skipped with
    // its honest reason; no evidence row ever enters the artifact.
    const c = await actor('practice-export-skip');
    await grant(c);
    const cstudy = await confirmedStudy(c, multiPlan);
    await requestCourseGeneration(c, cstudy.rootId, { ...command(cstudy.revision) });
    await runCourseGeneration(await jobOf(c, cstudy.rootId));
    const ccourse = await courseRowOf(c, cstudy.rootId);
    await submitPracticeCard(c, cstudy.rootId, { ...command(cstudy.revision), courseId: ccourse.id, cardId: 'practice:0', attempted: 'one', assisted: false });
    const exportPreview = await listExports(c);
    const category = exportPreview.categories.find(item => item.category === 'practice-evidence');
    expect(category).toMatchObject({ available: true, count: null });
    expect(category?.note).toContain('deliberately excluded');
    const manifest = await transaction(client => captureManifest(client, c.userId));
    const skip = manifest.skipped.find(item => item.category === 'practice-evidence');
    expect(skip?.reason).toContain('Deliberately excluded');
    expect(skip?.reason).toContain('answer keys');
    expect(manifest.entries.every(entry => entry.category !== 'practice-evidence')).toBe(true);
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
// Epic-2 S5 note: the conflict gap names COVERAGE and ASSERTION QUALITY —
// terms of source two's SERVED remainder (the opening sentence is now a
// withheld practice-card answer), so the side-by-side conflict still fires
// against the lesson text the learner actually sees.
const supplementsPlan: Plan = {
  ...plan,
  missingExplanations: 'Sources do not cover mock frameworks. A conflicting statement about coverage and assertion quality appears in public documentation. One unverifiable claim exists about coverage.',
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
    // Conflict: both sources recorded, never resolved. The upload side is the
    // SERVED remainder of source two (its opening sentence is a withheld
    // practice-card answer and never appears in lesson text).
    const conflict = state.gaps[1].supplement!;
    expect(conflict.passage).toContain('not the case');
    expect(conflict.conflict?.uploadExcerpt).toContain('Coverage reports');
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

// ---------------------------------------------------------------------------
// Epic-2 S4: background and goal adaptation. The same confirmed plan and the
// same synthetic source texts generate per-track TREATMENT with IDENTICAL
// factual claims and source links — asserted on the settled content through
// the cross-track fact-identity validator, never eyeballed. Changed
// preferences flow to the next confirmed revision through the honest
// re-save → re-confirm → regenerate path (one course per confirmed revision)
// without touching earned tracker state; missing or unmatched backgrounds
// default neutrally and claim no track; stored pre-2.4 v1/v2 rows serve
// unchanged; and the v7 disclosure names the stated background category with
// existing v6 grants honestly lapsed.
// ---------------------------------------------------------------------------

async function readyContentOf(rootId: string) {
  const row = await database().query<{ content: unknown }>("SELECT content FROM app.generated_course WHERE root_id=$1 AND status='ready' ORDER BY version DESC LIMIT 1", [rootId]);
  const settled = storedCourseContent(row.rows[0]?.content);
  if (!settled) throw new Error('stored content did not settle');
  return settled;
}

async function statedBackground(identity: Identity, background: string, expectedRevision = 0): Promise<number> {
  // The first save a fresh owner makes bumps the pinned revision 0→1 (no
  // prior row counts as plan-relevant); background-only re-saves then keep it.
  const saved = await savePreferences(identity, {
    schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision,
    stage: 'goal', goal: null, topic: '', clarification: '', background,
    timePreference: null, timezone: '',
  });
  return saved.revision;
}

describe('epic-2 S4: background and goal adaptation', () => {
  it('generates the same objective under two tracks: treatment differs, every factual claim and source link identical', async () => {
    const a = await actor('adapt-side-beginner');
    await grant(a);
    await statedBackground(a, 'non-CS, new to programming');
    const studyA = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, studyA.rootId, { ...command(studyA.revision) });
    await runCourseGeneration(await jobOf(a, studyA.rootId));
    const b = await actor('adapt-side-advanced');
    await grant(b);
    await statedBackground(b, 'CS graduate, interview prep');
    const studyB = await confirmedStudy(b, multiPlan);
    await requestCourseGeneration(b, studyB.rootId, { ...command(studyB.revision) });
    await runCourseGeneration(await jobOf(b, studyB.rootId));
    const beginner = await readyContentOf(studyA.rootId);
    const advanced = await readyContentOf(studyB.rootId);
    expect(contentAdaptation(beginner)).toEqual({ track: 'beginner', backgroundSummary: 'non-CS, new to programming' });
    expect(contentAdaptation(advanced)).toEqual({ track: 'advanced', backgroundSummary: 'CS graduate, interview prep' });
    // Treatment differs per track AND DELIVERS the pitch: the beginner
    // framing carries a concrete everyday example built from the lesson's own
    // outcome text plus an explicit prerequisite line; the advanced framing
    // carries an actual application scenario and a concrete trade-off question.
    const beginnerFraming = lessonFraming(beginner.lessons[0]) ?? '';
    const advancedFraming = lessonFraming(advanced.lessons[0]) ?? '';
    expect(beginnerFraming).not.toBe(advancedFraming);
    expect(beginnerFraming).toContain('Everyday example:');
    expect(beginnerFraming).toContain('working toward “Explain arrange-act-assert”');
    expect(beginnerFraming).toContain('Before this lesson you need:');
    expect(beginnerFraming).toContain('no prior programming assumed');
    expect(advancedFraming).toContain('Scenario:');
    expect(advancedFraming).toContain('“Explain arrange-act-assert”');
    expect(advancedFraming).toContain('Trade-off to weigh:');
    // …while the factual core is identical at filename+locator level (each
    // study owns its own extraction ids — extractionId equality is covered by
    // the unit side-by-side).
    expect(factsIdenticalAcrossTracks(beginner, advanced, { ignoreSourceIds: true })).toEqual({ identical: true, differences: [] });
    expect(beginner.lessons.map(lesson => lesson.sections.map(section => section.text))).toEqual(advanced.lessons.map(lesson => lesson.sections.map(section => section.text)));
    expect(beginner.lessons.map(lesson => lesson.title)).toEqual(multiPlan.miniCourse.lessons);
    // The two tracks SHARE the stored factual-core digest (treatment excluded)
    // and the served views expose it for cheap cross-course identity checks.
    expect(contentFactsDigest(beginner)).toMatch(/^[0-9a-f]{64}$/u);
    expect(contentFactsDigest(beginner)).toBe(contentFactsDigest(advanced));
    // The served views expose the stored adaptation basis and per-lesson
    // framing, keep the honesty label and sources, and still withhold the
    // recall answer from every GET payload.
    const viewA = await getCourse(a, studyA.rootId);
    const viewB = await getCourse(b, studyB.rootId);
    expect(viewA.state === 'ready' && viewA.course.adaptation?.track).toBe('beginner');
    expect(viewB.state === 'ready' && viewB.course.adaptation?.track).toBe('advanced');
    if (viewA.state !== 'ready' || viewB.state !== 'ready') return;
    expect(viewA.course.lessons[0].framing).not.toBe(viewB.course.lessons[0].framing);
    expect(viewA.course.factsDigest).toBe(viewB.course.factsDigest);
    expect(viewA.course.lessons[0].sections[0].source.filename).toBe('notes.txt');
    for (const serialized of [JSON.stringify(viewA), JSON.stringify(viewB)]) {
      expect(serialized).not.toContain(canonicalAnswer);
      expect(serialized).not.toContain('"answer"');
    }
  });

  it('missing and unmatched backgrounds generate neutrally and claim no track', async () => {
    const a = await actor('adapt-neutral-none');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan); // no preference row at all
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const none = await readyContentOf(study.rootId);
    expect(contentAdaptation(none)).toEqual({ track: 'neutral', backgroundSummary: '' });
    expect(none.lessons.every(lesson => /no track-specific framing/i.test(lessonFraming(lesson) ?? ''))).toBe(true);
    const b = await actor('adapt-neutral-unmatched');
    await grant(b);
    await statedBackground(b, 'part-time ornithologist');
    const studyB = await confirmedStudy(b, multiPlan);
    await requestCourseGeneration(b, studyB.rootId, { ...command(studyB.revision) });
    await runCourseGeneration(await jobOf(b, studyB.rootId));
    const unmatched = await readyContentOf(studyB.rootId);
    // The unmatched background is recorded honestly; the track claims nothing.
    expect(contentAdaptation(unmatched)).toEqual({ track: 'neutral', backgroundSummary: 'part-time ornithologist' });
    const view = await getCourse(b, studyB.rootId);
    expect(view.state === 'ready' && view.course.adaptation).toEqual({ track: 'neutral', backgroundSummary: 'part-time ornithologist' });
  });

  it('changed preferences flow to the next confirmed revision: the superseding version adapts anew and prior tracker state stays untouched', async () => {
    const a = await actor('adapt-change');
    await grant(a);
    const preferenceRevision = await statedBackground(a, 'non-CS, new to programming');
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const v1 = await courseRowOf(a, study.rootId);
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: v1.id, itemId: 'lesson:1:reading' });
    const v1Framing = lessonFraming((await readyContentOf(study.rootId)).lessons[0]) ?? '';
    // The background changes to an advanced one (a background-only change
    // keeps the pinned revision — epic-1's optional-preference rule). The
    // honest path to a newly pitched course is re-save → re-confirm → generate
    // (one course per confirmed revision; goal/topic changes additionally
    // ride the existing preference-revision pin).
    await statedBackground(a, 'CS graduate, interview prep', preferenceRevision);
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...multiPlan, topic: 'Unit testing, deeper' }, selectionId: study.selection!.id, extractionId: study.extractionIds[0] });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await requestCourseGeneration(a, study.rootId, { ...command(confirmed.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const current = await getCourse(a, study.rootId);
    expect(current.state).toBe('ready');
    if (current.state !== 'ready') return;
    expect(current.course.version).toBe(2);
    expect(current.course.adaptation).toEqual({ track: 'advanced', backgroundSummary: 'CS graduate, interview prep' });
    expect(current.course.lessons[0].framing).not.toBe(v1Framing); // re-pitched treatment
    expect(current.course.items.every(item => !item.done)).toBe(true); // fresh tracker for the fresh version
    // The prior version keeps BOTH its own adaptation basis and its earned
    // tracker state — nothing of the studied version was rewritten.
    const prior = await getCourse(a, study.rootId, v1.id);
    expect(prior.state).toBe('ready');
    if (prior.state === 'ready') {
      expect(prior.course.adaptation).toEqual({ track: 'beginner', backgroundSummary: 'non-CS, new to programming' });
      expect(prior.course.superseded).toBe(true);
      expect(prior.course.lessons[0].framing).toBe(v1Framing);
      expect(prior.course.items.find(item => item.id === 'lesson:1:reading')?.done).toBe(true);
    }
  });

  it('serves a stored pre-2.4 v2 course unchanged: no adaptation, no framing, neutral presentation', async () => {
    const a = await actor('adapt-legacy-v2');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const generated = await courseRowOf(a, study.rootId);
    const v2Content = {
      contentVersion: 2,
      lessons: [{ title: 'What a unit test is', sections: [{ text: 'A unit test isolates one behavior.', sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }], items: [{ id: 'lesson:1:reading', kind: 'reading', required: true, title: 'Read lesson 1: What a unit test is' }] }],
      objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
      recall: { objectiveIndex: 0, sourceRef: { extractionId: study.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' }, prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
    };
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [generated.id, v2Content]);
    const state = await getCourse(a, study.rootId);
    expect(state.state).toBe('ready');
    if (state.state === 'ready') {
      expect(state.course.adaptation).toBeNull(); // missing adaptation ⇒ neutral presentation
      expect(state.course.lessons[0].framing).toBeNull();
      expect(state.course.lessons[0].title).toBe('What a unit test is');
      expect(state.course.items.map(item => item.id)).toEqual(['lesson:1:reading']);
    }
    // No regeneration-on-read: the stored document keeps its exact v2 shape.
    const stored = await database().query<{ content: { contentVersion?: number } }>('SELECT content FROM app.generated_course WHERE id=$1', [generated.id]);
    expect(stored.rows[0].content.contentVersion).toBe(2);
  });

  it('pins the pitch basis at request time: a background edited before the worker runs does not re-pitch the settled course', async () => {
    const a = await actor('adapt-pin');
    await grant(a);
    const preferenceRevision = await statedBackground(a, 'non-CS, new to programming');
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    // The pin snapshot is on the request row the moment it exists.
    const pinned = await database().query<{ preference_pin: { background: string; goal: unknown; topic: string } | null }>(
      "SELECT preference_pin FROM app.generated_course WHERE root_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [study.rootId]);
    expect(pinned.rows[0].preference_pin).toMatchObject({ goal: '', topic: '', background: 'non-CS, new to programming' });
    // The background changes AFTER the request, BEFORE the job runs — the
    // settled course still carries the request-time pitch.
    await statedBackground(a, 'CS graduate, interview prep', preferenceRevision);
    await runCourseGeneration(await jobOf(a, study.rootId));
    const settled = await readyContentOf(study.rootId);
    expect(contentAdaptation(settled)).toEqual({ track: 'beginner', backgroundSummary: 'non-CS, new to programming' });
    expect(lessonFraming(settled.lessons[0])).toContain('Everyday example:');
    // Legacy row without a pin (pre-review rows): the worker falls back to the
    // CURRENT preference row — here a background first stated after the request.
    const b = await actor('adapt-pin-legacy');
    await grant(b);
    const legacyStudy = await confirmedStudy(b, multiPlan);
    await requestCourseGeneration(b, legacyStudy.rootId, { ...command(legacyStudy.revision) });
    await database().query("UPDATE app.generated_course SET preference_pin=NULL WHERE root_id=$1 AND status='pending'", [legacyStudy.rootId]);
    await statedBackground(b, 'non-CS, new to programming');
    await runCourseGeneration(await jobOf(b, legacyStudy.rootId));
    const legacy = await readyContentOf(legacyStudy.rootId);
    expect(contentAdaptation(legacy)).toEqual({ track: 'beginner', backgroundSummary: 'non-CS, new to programming' });
  });

  it('a grant recorded under a version other than the current disclosure honestly lapses (the v7 re-grant rule)', async () => {
    // The canonical v7 row (the migration's stated-background disclosure) is
    // pinned on a FRESH database by migration.test.ts; on this shared dev
    // database sibling suites' synthetic spy fixtures can squat small version
    // numbers — the standing drift grant() already tolerates — so this test
    // asserts the version-coupled lapse rule generically.
    const current = await database().query<{ version: number }>('SELECT version FROM app.processor_configuration ORDER BY version DESC LIMIT 1');
    const a = await actor('adapt-consent-lapse');
    const study = await confirmedStudy(a);
    await grant(a);
    await database().query('UPDATE app.processing_decision SET disclosure_version=$2 WHERE owner_id=$1', [a.userId, current.rows[0].version - 1]);
    await expect(requestCourseGeneration(a, study.rootId, { ...command(study.revision) })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const rows = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1', [a.userId]);
    expect(rows.rows[0].count).toBe(0);
    await grant(a); // the one honest re-grant
    const receipt = await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    expect(receipt.state).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Epic-2 S6: learner-controlled why exploration with honest stopping. The
// default processor is the local synthetic why fixture (zero network): two
// successive grounded levels with fixed dimensions, the structural exhaustion
// precondition (zero dispatch, no row), replay/duplicate/self-heal
// idempotency, the standard denial surface, restatement rejection, lifecycle
// purge with the course lineage, the export skip, and legacy stored courses
// deriving levels from their own evidence.
// ---------------------------------------------------------------------------

describe('epic-2 S6: learner-controlled why exploration', () => {
  it('grounds two successive levels on a fixture lesson — distinct non-restatement dimensions, visible sources, zero unlock', async () => {
    const a = await actor('why-happy');
    await grant(a);
    // One lesson acknowledged with three sources → three lesson sections: the
    // evidence pool grounds why depth 2 (pieces − 1, capped at the two fixed
    // dimensions).
    const study = await confirmedStudy(a, plan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    let state = await getWhyState(a, study.rootId, course.id, '0');
    expect(state.availableDepth).toBe(2);
    expect(state.levels.map(level => [level.depth, level.status, level.dimension])).toEqual([
      [1, 'available', 'purpose'],
      [2, 'available', 'assumptions-trade-offs'],
    ]);
    // Fixed sequencing: level 2 before level 1 settled is a stale-view
    // conflict, never a skipped rung.
    await expect(requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const first = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    expect(first).toMatchObject({ state: 'pending', depth: 1, courseId: course.id, lessonIndex: 0 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 1));
    state = await getWhyState(a, study.rootId, course.id, '0');
    const level1 = state.levels[0];
    expect(level1.status).toBe('ready');
    expect(level1.explanation?.dimension).toBe('purpose');
    expect(level1.explanation?.sources.length).toBeGreaterThanOrEqual(1);
    const names = new Set(['notes.txt', 'doubles.txt', 'third.txt']);
    for (const source of level1.explanation!.sources) {
      expect(source.kind).toBe('lesson');
      expect(names.has((source as { filename: string }).filename)).toBe(true);
      expect((source as { locator: string }).locator.length).toBeGreaterThanOrEqual(1);
    }
    // Non-restatement, structurally: the settled text is none of the lesson's
    // own section texts (the parser's sentence-containment check ran too).
    const stored = await database().query<{ content: { lessons: Array<{ sections: Array<{ text: string }> }> } }>('SELECT content FROM app.generated_course WHERE id=$1', [course.id]);
    const lessonTexts = stored.rows[0].content.lessons[0].sections.map(section => section.text);
    expect(lessonTexts.includes(level1.explanation!.text)).toBe(false);
    // Second level: a distinct dimension with distinct prose.
    const second = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 });
    expect(second).toMatchObject({ state: 'pending', depth: 2 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 2));
    state = await getWhyState(a, study.rootId, course.id, '0');
    const level2 = state.levels[1];
    expect(level2.status).toBe('ready');
    expect(level2.explanation?.dimension).toBe('assumptions-trade-offs');
    expect(level2.explanation?.text).not.toBe(level1.explanation?.text);
    // Exactly one row per level; the ladder serves both.
    const rows = await database().query<{ depth: number; status: string }>('SELECT depth,status FROM app.why_explanation WHERE course_id=$1 ORDER BY depth', [course.id]);
    expect(rows.rows).toEqual([{ depth: 1, status: 'ready' }, { depth: 2, status: 'ready' }]);
    // Depth unlocked NOTHING: no tracker rows, no done items, no scored
    // semantics anywhere in the served state, and only honest provenance.
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id=$1', [course.id])).rows[0].count).toBe(0);
    const view = await getCourse(a, study.rootId);
    expect(view.state === 'ready' && view.course.items.every(item => !item.done)).toBe(true);
    for (const banned of ['"score"', '"credit"', '"completion"', '"unlock"', '"attempt"']) expect(JSON.stringify(state)).not.toContain(banned);
    expect(state.levels.every(level => level.status === 'ready')).toBe(true);
    // Ledger honesty: one zero-token row per dispatch (generation + two why
    // steps), tokens never fabricated.
    const ledger = await database().query<{ count: number; tokens: number }>("SELECT count(*)::int AS count, COALESCE(sum(total_tokens),0)::int AS tokens FROM app.ai_dispatch_ledger WHERE owner_id=$1", [a.userId]);
    expect(ledger.rows[0]).toMatchObject({ count: 3, tokens: 0 });
  });

  it('exhaustion is a precondition: past the stored evidence → honest verdict, zero dispatch, no row; verified supplements grow availability', async () => {
    const a = await actor('why-exhaustion');
    await grant(a);
    // Two sources, one lesson → two sections: only depth 1 is grounded.
    const study = await confirmedStudy(a, plan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    expect((await getWhyState(a, study.rootId, course.id, '0')).availableDepth).toBe(1);
    const exhausted = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 });
    expect(exhausted).toMatchObject({ state: 'exhausted', depth: 2, availableDepth: 1, courseId: course.id });
    // Even further past: the same honest verdict.
    expect(await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 5 })).toMatchObject({ state: 'exhausted' });
    // ZERO dispatch and ZERO stored response: no why row, no admission beyond
    // the generation's, no ledger row.
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.why_explanation WHERE owner_id=$1', [a.userId])).rows[0].count).toBe(0);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.dispatch_admission WHERE owner_id=$1', [a.userId])).rows[0].count).toBe(1);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1', [a.userId])).rows[0].count).toBe(1);
    // Level 1 still grounds and settles.
    await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 1));
    expect((await getWhyState(a, study.rootId, course.id, '0')).levels[0].status).toBe('ready');
    // A verified supplement pass grows the evidence pool: the default plan's
    // one declared gap resolves supported, so depth 2 becomes groundable and
    // its settled level cites the supplement beside the lesson sources.
    await requestSupplements(a, study.rootId, { ...command(study.revision), courseId: course.id });
    await runSupplementFetch(await supplementJobOf(a, course.id));
    const grown = await getWhyState(a, study.rootId, course.id, '0');
    expect(grown.availableDepth).toBe(2);
    expect(grown.levels[1].status).toBe('available');
    const admitted = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 });
    expect(admitted).toMatchObject({ state: 'pending', depth: 2 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 2));
    const settled = await getWhyState(a, study.rootId, course.id, '0');
    expect(settled.levels[1].status).toBe('ready');
    const supplementSource = settled.levels[1].explanation?.sources.find(source => source.kind === 'supplement');
    expect(supplementSource).toMatchObject({ kind: 'supplement', origin: 'docs.example.org' });
  });

  it('replays one command, no-ops duplicate delivery, returns the settled explanation to a repeat command and self-heals a stranded row', async () => {
    const a = await actor('why-replay');
    await grant(a);
    const study = await confirmedStudy(a, plan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const envelope = { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 };
    const first = await requestWhyStep(a, study.rootId, envelope);
    expect(first.state).toBe('pending');
    expect(await requestWhyStep(a, study.rootId, envelope)).toEqual(first); // command replay
    const job = await whyJobOf(a, course.id, 0, 1);
    await runWhyStep(job);
    await runWhyStep(job); // duplicate delivery: status guard no-ops
    expect((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.why_explanation WHERE course_id=$1 AND depth=1", [course.id])).rows[0].count).toBe(1);
    // A DIFFERENT command for the settled level returns the existing
    // explanation's receipt without a second dispatch.
    const repeat = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    expect(repeat).toMatchObject({ state: 'ready', operationId: job.requestId, depth: 1 });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.dispatch_admission WHERE owner_id=$1', [a.userId])).rows[0].count).toBe(2); // generation + level 1 only
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1', [a.userId])).rows[0].count).toBe(2);
    // Stranded pending past the honest 120-second cap: a new command marks it
    // failed 'timeout' and re-pends the SAME row under a fresh admission.
    const stranded = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 });
    expect(stranded).toMatchObject({ state: 'pending' });
    const strandedId = (stranded as WhyReceipt).operationId!;
    await database().query("UPDATE app.why_explanation SET created_at=clock_timestamp()-interval '130 seconds' WHERE id=$1", [strandedId]);
    const retried = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 });
    expect(retried).toMatchObject({ state: 'pending', operationId: strandedId }); // same row, fresh admission
    await runWhyStep(await whyJobOf(a, course.id, 0, 2));
    const healed = await database().query<{ status: string; failure_code: string | null; explanation: string | null }>('SELECT status,failure_code,explanation FROM app.why_explanation WHERE id=$1', [strandedId]);
    expect(healed.rows[0]).toMatchObject({ status: 'ready', failure_code: null });
    expect(healed.rows[0].explanation).not.toBeNull();
    // A late delivery carrying a stale admission no-ops against the admission
    // guard (the row was re-pended under a newer admission).
    await runWhyStep({ schemaVersion: 1, requestId: strandedId, admissionId: crypto.randomUUID(), courseId: course.id, rootId: study.rootId, ownerId: a.userId, sessionId: a.sessionId, lessonIndex: 0, depth: 2 });
    expect((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.why_explanation WHERE course_id=$1", [course.id])).rows[0].count).toBe(2);
  });

  it('denies honestly: consent, cross-owner, unknown course/lesson, stale revision, invalid bodies — zero recorded effect', async () => {
    // Declined owner: a ready course exists, but the latest decision under the
    // current disclosure is not granted — the why step is blocked with zero
    // effect (the same state a lapsed grant is in).
    const blocked = await actor('why-consent-blocked');
    await grant(blocked);
    const blockedStudy = await confirmedStudy(blocked, plan, [textA, textB, textC]);
    await requestCourseGeneration(blocked, blockedStudy.rootId, { ...command(blockedStudy.revision) });
    await runCourseGeneration(await jobOf(blocked, blockedStudy.rootId));
    const blockedCourse = await courseRowOf(blocked, blockedStudy.rootId);
    await decide(blocked, { ...command(), configurationVersion: (await getDisclosure(blocked)).configuration.version, decision: 'declined', acknowledgedTerms: true });
    await expect(requestWhyStep(blocked, blockedStudy.rootId, { ...command(blockedStudy.revision), courseId: blockedCourse.id, lessonIndex: 0, depth: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.why_explanation WHERE owner_id=$1', [blocked.userId])).rows[0].count).toBe(0);
    const a = await actor('why-denied-a');
    await grant(a);
    const study = await confirmedStudy(a, plan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const b = await actor('why-denied-b');
    await grant(b);
    // Cross-owner: the standard no-leak denial for both verbs.
    await expect(requestWhyStep(b, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getWhyState(b, study.rootId, course.id, '0')).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Unknown course under the owner's own root: the same actionable state as
    // the recall path (generate first); unknown lesson likewise.
    await expect(requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: crypto.randomUUID(), lessonIndex: 0, depth: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 5, depth: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(getWhyState(a, study.rootId, course.id, '9')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(getWhyState(a, study.rootId, course.id)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // Stale expectedRevision conflicts honestly; invalid bodies never record.
    await expect(requestWhyStep(a, study.rootId, { ...command(study.revision + 5), courseId: course.id, lessonIndex: 0, depth: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const body of [
      { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 0 },
      { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 9 },
      { ...command(study.revision), courseId: course.id, depth: 1 },
      { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1, extra: 1 },
    ]) await expect(requestWhyStep(a, study.rootId, body)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.why_explanation WHERE owner_id=ANY($1::uuid[])', [[a.userId, b.userId, blocked.userId]])).rows[0].count).toBe(0);
  });

  it('rejects restatement-shaped drafts as invalid-output honestly and retries via a new command', async () => {
    const a = await actor('why-restatement');
    await grant(a);
    const study = await confirmedStudy(a, plan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    const job = await whyJobOf(a, course.id, 0, 1);
    // A processor that returns the lesson's OWN first section text verbatim as
    // the explanation: restatement-shaped, rejected — not repaired.
    const stored = await database().query<{ content: { lessons: Array<{ sections: Array<{ text: string }> }> } }>('SELECT content FROM app.generated_course WHERE id=$1', [course.id]);
    const copied = stored.rows[0].content.lessons[0].sections[0].text;
    const restating = portOf({ ok: true, text: JSON.stringify({ explanation: copied, citations: [{ kind: 'lesson', index: 0 }] }), provenance: { requestedModel: 'x', returnedModel: 'x-fake' }, usage });
    await runWhyStep(job, restating);
    const failed = await getWhyState(a, study.rootId, course.id, '0');
    expect(failed.levels[0].status).toBe('failed');
    expect(failed.levels[0].failureCode).toBe('invalid-output');
    expect((await database().query<{ explanation: string | null }>('SELECT explanation FROM app.why_explanation WHERE id=$1', [job.requestId])).rows[0].explanation).toBeNull();
    // A NEW command retries the same level (re-pend under a fresh admission)
    // and the default fixture settles it.
    const retried = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    expect(retried).toMatchObject({ state: 'pending', operationId: job.requestId });
    await runWhyStep(await whyJobOf(a, course.id, 0, 1));
    const settled = await getWhyState(a, study.rootId, course.id, '0');
    expect(settled.levels[0].status).toBe('ready');
  });

  it('discards the result when consent is withdrawn mid-flight; a claim race persists nothing', async () => {
    const a = await actor('why-withdrawn');
    await grant(a);
    const study = await confirmedStudy(a, plan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    const job = await whyJobOf(a, course.id, 0, 1);
    await withdraw(a, command());
    await runWhyStep(job);
    const failed = await getWhyState(a, study.rootId, course.id, '0');
    expect(failed.levels[0]).toMatchObject({ status: 'failed', failureCode: 'rejected-late' });
    expect((await database().query<{ explanation: string | null }>('SELECT explanation FROM app.why_explanation WHERE id=$1', [job.requestId])).rows[0].explanation).toBeNull();
    // Claim race (a fresh owner — withdrawal above is terminal): a delivery
    // whose row reached a terminal state during the completion commits no
    // explanation and no ledger row.
    const b = await actor('why-claim-race');
    await grant(b);
    const race = await confirmedStudy(b, plan, [textA, textB, textC]);
    await requestCourseGeneration(b, race.rootId, { ...command(race.revision) });
    await runCourseGeneration(await jobOf(b, race.rootId));
    const raceCourse = await courseRowOf(b, race.rootId);
    await requestWhyStep(b, race.rootId, { ...command(race.revision), courseId: raceCourse.id, lessonIndex: 0, depth: 1 });
    const racingJob = await whyJobOf(b, raceCourse.id, 0, 1);
    const before = (await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1', [b.userId])).rows[0].count;
    const racing: () => TextCompletionPort = () => ({
      complete: async () => {
        await database().query("UPDATE app.why_explanation SET status='failed',failure_code='timeout',settled_at=clock_timestamp() WHERE id=$1 AND status='pending'", [racingJob.requestId]);
        return { ok: true, text: JSON.stringify({ explanation: 'Brand new prose that carries real depth beyond the lesson text entirely.', citations: [{ kind: 'lesson', index: 0 }] }), provenance: { requestedModel: 'race-fixture', returnedModel: 'race-fixture' }, usage };
      },
    });
    await runWhyStep(racingJob, racing);
    const row = await database().query<{ status: string; failure_code: string | null; explanation: string | null }>('SELECT status,failure_code,explanation FROM app.why_explanation WHERE id=$1', [racingJob.requestId]);
    expect(row.rows[0]).toMatchObject({ status: 'failed', failure_code: 'timeout' });
    expect(row.rows[0].explanation).toBeNull();
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1', [b.userId])).rows[0].count).toBe(before);
  });

  it('serves legacy v1–v3 stored courses: levels derive from their own stored evidence', async () => {
    const a = await actor('why-legacy');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const generated = await courseRowOf(a, study.rootId);
    // A legacy v1 row with TWO stored sections: its own evidence grounds
    // depth 1 (and only depth 1 — the stored evidence is what it is).
    const legacyContent = {
      lessonTitle: 'What a unit test is',
      sections: [
        { text: 'A legacy section states the primary behavior.', sourceRef: { extractionId: study.extractionIds[0], filename: 'legacy-a.txt', locator: 'lines 1-2' } },
        { text: 'A second legacy section adds surrounding conditions.', sourceRef: { extractionId: study.extractionIds[1] ?? study.extractionIds[0], filename: 'legacy-b.txt', locator: 'lines 3-4' } },
      ],
      objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
      recall: { objectiveIndex: 0, sourceRef: { extractionId: study.extractionIds[0], filename: 'legacy-a.txt', locator: 'lines 1-2' }, prompt: 'State the behavior.', answer: 'The primary behavior.', rationale: 'Stated in legacy-a.txt.' },
    };
    expect(courseContentV1Schema.safeParse(legacyContent).success).toBe(true);
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [generated.id, legacyContent]);
    const state = await getWhyState(a, study.rootId, generated.id, '0');
    expect(state.availableDepth).toBe(1);
    expect(state.lessonTitle).toBe('What a unit test is');
    const admitted = await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: generated.id, lessonIndex: 0, depth: 1 });
    expect(admitted).toMatchObject({ state: 'pending', depth: 1 });
    await runWhyStep(await whyJobOf(a, generated.id, 0, 1));
    const settled = await getWhyState(a, study.rootId, generated.id, '0');
    expect(settled.levels[0].status).toBe('ready');
    const filenames = settled.levels[0].explanation?.sources.map(source => (source as { filename?: string }).filename ?? '');
    expect(filenames?.every(name => name === 'legacy-a.txt' || name === 'legacy-b.txt')).toBe(true);
    // Depth 2 on the same stored evidence: the honest exhaustion verdict.
    expect(await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: generated.id, lessonIndex: 0, depth: 2 })).toMatchObject({ state: 'exhausted', availableDepth: 1 });
    // No regeneration-on-read: the stored document keeps its exact v1 shape.
    const stored = await database().query<{ content: { lessonTitle?: string; contentVersion?: number } }>('SELECT content FROM app.generated_course WHERE id=$1', [generated.id]);
    expect(stored.rows[0].content.lessonTitle).toBe('What a unit test is');
    expect(stored.rows[0].content.contentVersion).toBeUndefined();
  });

  it('root deletion purges why rows with the course lineage; personal removal purges them with the owner; export records the honest skip', async () => {
    const a = await actor('why-purge');
    await grant(a);
    const study = await confirmedStudy(a, plan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 1));
    await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 2 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 2));
    // The deletion preview counts why explanations as their own category.
    const preview = await transaction(client => previewDerivatives(client, { ownerId: a.userId, rootIds: [study.rootId], objectIds: [], personal: false }));
    expect(preview.find(category => category.key === 'why-explanations')).toMatchObject({ label: 'AI why explanations', count: 2 });
    await removeRoot(a, study.rootId, { ...command(study.revision) });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.why_explanation WHERE course_id=$1', [course.id])).rows[0].count).toBe(0);
    // Personal removal purges why rows with the owner.
    const b = await actor('why-purge-personal');
    await grant(b);
    const other = await confirmedStudy(b, plan, [textA, textB, textC]);
    await requestCourseGeneration(b, other.rootId, { ...command(other.revision) });
    await runCourseGeneration(await jobOf(b, other.rootId));
    const otherCourse = await courseRowOf(b, other.rootId);
    await requestWhyStep(b, other.rootId, { ...command(other.revision), courseId: otherCourse.id, lessonIndex: 0, depth: 1 });
    await runWhyStep(await whyJobOf(b, otherCourse.id, 0, 1));
    await personalRemoval(b, { ...command() });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.why_explanation WHERE owner_id=$1', [b.userId])).rows[0].count).toBe(0);
    // The export surface lists why-explanations as deliberately skipped with
    // its honest reason; no explanation row ever enters the artifact.
    const c = await actor('why-export-skip');
    await grant(c);
    const cstudy = await confirmedStudy(c, plan, [textA, textB, textC]);
    await requestCourseGeneration(c, cstudy.rootId, { ...command(cstudy.revision) });
    await runCourseGeneration(await jobOf(c, cstudy.rootId));
    const ccourse = await courseRowOf(c, cstudy.rootId);
    await requestWhyStep(c, cstudy.rootId, { ...command(cstudy.revision), courseId: ccourse.id, lessonIndex: 0, depth: 1 });
    await runWhyStep(await whyJobOf(c, ccourse.id, 0, 1));
    const exportPreview = await listExports(c);
    const category = exportPreview.categories.find(item => item.category === 'why-explanations');
    expect(category).toMatchObject({ available: true, count: null });
    expect(category?.note).toContain('deliberately excluded');
    const manifest = await transaction(client => captureManifest(client, c.userId));
    const skip = manifest.skipped.find(item => item.category === 'why-explanations');
    expect(skip?.reason).toContain('Deliberately excluded');
    expect(skip?.reason).toContain('advisory depth');
    expect(manifest.entries.every(entry => entry.category !== 'why-explanations')).toBe(true);
  });
});
