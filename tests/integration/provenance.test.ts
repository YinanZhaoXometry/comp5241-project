import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { removeRoot } from '../../src/modules/lifecycle-platform/service';
import { requestCourseGeneration, getProvenance, submitPracticeCard, markItemDone, requestSupplements, requestWhyStep } from '../../src/modules/course-generation/service';
import { runCourseGeneration, runSupplementFetch, runWhyStep } from '../../src/modules/course-generation/worker';
import { computeFactsDigest } from '../../src/modules/course-generation/adaptation';
import { courseContentV1Schema, courseContentV3Schema } from '../../src/contracts/courses';
import type { ProvenanceDocument, ProvenanceState } from '../../src/contracts/provenance';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { CourseJob, SupplementJob, WhyJob } from '../../src/contracts/courses';

// Epic-2 S7 LOCAL SYNTHETIC coverage of the versioned provenance and
// downstream handoff surface: the authorized query contract epics 3/5/6
// consume. The heart of the file is the synthetic consumer below — a fake
// consumer written ONLY against the contract types (never module internals)
// asserting the documented behaviors: the IMMUTABLE block (course lineage,
// objectives, units, practice items, tracker inventory) byte-stable across a
// superseding revision AND across the version's own derivative growth, the
// MONOTONIC derivatives block (supplements/why may only gain entries),
// structural scope denial of out-of-contract fields (answers/attempts —
// including through a repeated ?fields= parameter), the standard no-leak
// denial taxonomy, honest ungenerated states, legacy v1–v3 serving in their
// real shapes, and attempt independence.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

const plan: Plan = {
  topic: 'Unit testing fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const multiPlan: Plan = {
  ...plan,
  miniCourse: { ...plan.miniCourse, lessons: ['What a unit test is', 'Test doubles in depth', 'Reading coverage honestly'] },
};
// The supplements plan (see course-generation.test.ts): gap 0 supported, gap 1
// conflict, gap 2 unsupported — the settled pass feeds the derivatives block.
const supplementsPlan: Plan = {
  ...plan,
  missingExplanations: 'Sources do not cover mock frameworks. A conflicting statement about coverage and assertion quality appears in public documentation. One unverifiable claim exists about coverage.',
};
const textA = 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.';
const textB = 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.';
const textC = 'A third perspective rounds the reading out. Comparison across pieces is the point of arranging them.';

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

// The processor_configuration table is shared, ordered state: grant against
// the current version when it is eligible, otherwise pin this file's own
// clearly-labeled eligible fixture above it.
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

// ---------------------------------------------------------------------------
// THE FAKE CONSUMER — the contract's proof. It is written ONLY against the
// contract types (this is the module-internal-free half of the file): it
// receives a provenance state and reads the document per the documented
// behaviors. Epics 3/5/6 later copy this pattern as real consumers.
// ---------------------------------------------------------------------------
function consumerDocumentOf(state: ProvenanceState): ProvenanceDocument | null {
  return state.state === 'ready' ? state.provenance : null;
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-2 S7: versioned provenance and downstream handoff surface', () => {
  it('serves the full provenance document for the current confirmed course', async () => {
    const a = await actor('provenance-happy');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const state = await getProvenance(a, study.rootId);
    expect(state).toMatchObject({ state: 'ready', rootId: study.rootId, revision: study.revision });
    const document = consumerDocumentOf(state);
    expect(document).not.toBeNull();
    if (!document) return;
    const { immutable, derivatives } = document;
    // Course block: exact version identity plus the full generation lineage a
    // downstream consumer re-authorizes through its own scopes.
    expect(immutable.course).toMatchObject({ id: course.id, version: 1, model: 'local-synthetic-course-fixture-v1' });
    expect(immutable.course.lineage).toEqual({
      planRevisionId: study.planRevisionId,
      selectionId: study.selection!.id,
      extractionIds: study.extractionIds,
      objectId: expect.any(String),
      admissionId: expect.any(String),
    });
    expect(immutable.course.factsDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(immutable.course.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
    expect(new Date(immutable.course.createdAt).toString()).not.toBe('Invalid Date');
    expect(new Date(immutable.course.settledAt) >= new Date(immutable.course.createdAt)).toBe(true);
    // Objectives with versions, from the versioned course_objective lineage.
    expect(immutable.objectives).toEqual([
      { position: 0, text: 'Explain arrange-act-assert', version: 1 },
      { position: 1, text: 'Explain test doubles', version: 1 },
      { position: 2, text: 'Judge coverage reports', version: 1 },
    ]);
    // Source-linked units: every lesson in plan order, every section with its
    // full source-ref identity (extraction id, filename, locator).
    expect(immutable.units.map(unit => [unit.lesson, unit.title])).toEqual(multiPlan.miniCourse.lessons.map((title, index) => [index + 1, title]));
    for (const unit of immutable.units) {
      expect(unit.position).toBeGreaterThanOrEqual(0);
      expect(unit.text.length).toBeGreaterThanOrEqual(1);
      expect(study.extractionIds).toContain(unit.sourceRef.extractionId);
      expect(['notes.txt', 'doubles.txt']).toContain(unit.sourceRef.filename);
      expect(unit.sourceRef.locator.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(unit).sort()).toEqual(['lesson', 'position', 'sourceRef', 'text', 'title']);
    }
    // Practice items: one per objective with objective links and source refs —
    // and structurally no prompt, answer or rationale.
    expect(immutable.practiceItems.map(item => item.id)).toEqual(['practice:0', 'practice:1', 'practice:2']);
    expect(immutable.practiceItems.map(item => item.objectiveIndex)).toEqual([0, 1, 2]);
    for (const item of immutable.practiceItems) {
      expect(Object.keys(item).sort()).toEqual(['id', 'objectiveIndex', 'sourceRef']);
      expect(study.extractionIds).toContain(item.sourceRef.extractionId);
    }
    // No supplement pass and no why usage ran: honest empty derivatives.
    expect(derivatives.supplements).toEqual([]);
    expect(derivatives.whyExplanations).toEqual([]);
    // Tracker inventory: ids, required flags and titles only — no done state.
    expect(immutable.trackerItems.map(item => item.id)).toEqual(['lesson:1:reading', 'lesson:2:reading', 'lesson:3:reading', 'enrichment:1']);
    expect(immutable.trackerItems.map(item => item.required)).toEqual([true, true, true, false]);
    for (const item of immutable.trackerItems) expect(Object.keys(item).sort()).toEqual(['id', 'required', 'title']);
    // Attempt independence at the payload level: nothing attempt-adjacent
    // appears anywhere in the serialized document.
    for (const banned of ['"answer"', '"rationale"', '"attempted"', '"evidenceKind"', '"done"', '"score"', '"credit"', '"completion"']) expect(JSON.stringify(document)).not.toContain(banned);
  });

  it('pins the immutable block byte-stable across supersession and derivative growth while the default read moves; derivatives only gain entries', async () => {
    const a = await actor('provenance-pin');
    await grant(a);
    const study = await confirmedStudy(a, multiPlan);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const v1 = await courseRowOf(a, study.rootId);
    // The consumer snapshots the pinned document BEFORE any supersession.
    const pinnedBefore = consumerDocumentOf(await getProvenance(a, study.rootId, v1.id));
    expect(pinnedBefore).not.toBeNull();
    const defaultBefore = consumerDocumentOf(await getProvenance(a, study.rootId));
    expect(defaultBefore?.immutable.course.id).toBe(v1.id);
    // Supersede: re-save a changed plan, re-confirm, regenerate (version 2).
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan: { ...multiPlan, topic: 'Unit testing, deeper' }, selectionId: study.selection!.id, extractionId: study.extractionIds[0] });
    const confirmed = await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await requestCourseGeneration(a, study.rootId, { ...command(confirmed.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    // PIN STABILITY across supersession: the immutable block is byte-identical
    // (and with no derivatives yet, so is the whole document).
    const pinnedAfter = consumerDocumentOf(await getProvenance(a, study.rootId, v1.id));
    expect(pinnedAfter).not.toBeNull();
    expect(JSON.stringify(pinnedAfter?.immutable)).toBe(JSON.stringify(pinnedBefore?.immutable));
    expect(JSON.stringify(pinnedAfter)).toBe(JSON.stringify(pinnedBefore));
    // The version selector pins the same frozen immutable block.
    expect(consumerDocumentOf(await getProvenance(a, study.rootId, '1'))?.immutable.course.id).toBe(v1.id);
    // DEFAULT MOVED: a fresh default read serves the new version's document —
    // new course identity, new lineage, new objective versions.
    const defaultAfter = consumerDocumentOf(await getProvenance(a, study.rootId));
    expect(defaultAfter?.immutable.course.version).toBe(2);
    expect(defaultAfter?.immutable.course.id).not.toBe(v1.id);
    expect(defaultAfter?.immutable.course.lineage.planRevisionId).not.toBe(pinnedBefore?.immutable.course.lineage.planRevisionId);
    expect(defaultAfter?.immutable.course.lineage.admissionId).not.toBe(pinnedBefore?.immutable.course.lineage.admissionId);
    expect(defaultAfter?.immutable.objectives.map(objective => objective.version)).toEqual([2, 2, 2]);
    expect(defaultAfter?.immutable.objectives.map(objective => objective.text)).toEqual(multiPlan.outcomes);
    // PIN STABILITY across DERIVATIVE GROWTH: supplements attach to any ready
    // version — the pinned prior one included. The pinned document's immutable
    // block stays byte-identical while its derivatives only GAIN entries.
    expect(pinnedBefore?.derivatives.supplements).toHaveLength(0);
    await requestSupplements(a, study.rootId, { ...command(confirmed.revision), courseId: v1.id });
    await runSupplementFetch(await supplementJobOf(a, v1.id));
    const pinnedGrown = consumerDocumentOf(await getProvenance(a, study.rootId, v1.id));
    expect(JSON.stringify(pinnedGrown?.immutable)).toBe(JSON.stringify(pinnedBefore?.immutable));
    expect(pinnedGrown?.derivatives.supplements.map(supplement => supplement.outcome)).toEqual(['supported']); // monotonic growth on the pinned version
    expect(pinnedGrown?.derivatives.whyExplanations).toHaveLength(0);
    // The new version's document is untouched by the prior version's pass.
    const defaultUnchanged = consumerDocumentOf(await getProvenance(a, study.rootId));
    expect(defaultUnchanged?.derivatives.supplements).toHaveLength(0);
    expect(defaultUnchanged?.immutable).toEqual(defaultAfter?.immutable);
  });

  it('denies a fields= scope declaration naming anything outside the contract (answers, attempts) before reading', async () => {
    const a = await actor('provenance-scope');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    for (const fields of ['answers', 'attempts', 'rationales', 'attempted', 'answer,units', 'units,attempts', 'bogus', '']) {
      await expect(getProvenance(a, study.rootId, undefined, fields)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(getProvenance(a, study.rootId, study.extractionIds[0], fields)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    // A repeated ?fields= parameter: the route joins ALL values into one
    // declaration, so every named field reaches validation — a non-contract
    // name cannot hide behind a first valid value, in either order.
    await expect(getProvenance(a, study.rootId, undefined, ['course', 'answers'].join(','))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(getProvenance(a, study.rootId, undefined, ['answers', 'course'].join(','))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(getProvenance(a, study.rootId, undefined, ['units', 'attempts', 'course'].join(','))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // A legal declaration names contract fields only and still serves the
    // full document (declaring never projects — the response is the contract).
    const declared = await getProvenance(a, study.rootId, undefined, ['course', 'units'].join(','));
    expect(declared.state).toBe('ready');
    const declaredAll = await getProvenance(a, study.rootId, undefined, 'course,lineage,objectives,units,practiceItems,supplements,whyExplanations,trackerItems');
    expect(consumerDocumentOf(declaredAll)?.immutable.course.version).toBe(1);
  });

  it('denies cross-owner, deleted-root and unknown selectors with the standard no-leak denial; malformed selectors are invalid', async () => {
    const a = await actor('provenance-denied-a');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const b = await actor('provenance-denied-b');
    await grant(b);
    // Cross-owner: B on A's root is the same denial for default and pinned.
    await expect(getProvenance(b, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getProvenance(b, study.rootId, course.id)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // An unknown root denies identically.
    await expect(getProvenance(a, crypto.randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Unknown pinned selectors (foreign course id, unknown version) deny
    // without a leak; a malformed selector is invalid input.
    await expect(getProvenance(a, study.rootId, crypto.randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getProvenance(a, study.rootId, '9')).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getProvenance(a, study.rootId, 'not-a-uuid')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // A deleted root denies both reads.
    const gone = await actor('provenance-deleted');
    await grant(gone);
    const goneStudy = await confirmedStudy(gone);
    await requestCourseGeneration(gone, goneStudy.rootId, { ...command(goneStudy.revision) });
    await runCourseGeneration(await jobOf(gone, goneStudy.rootId));
    const goneCourse = await courseRowOf(gone, goneStudy.rootId);
    await removeRoot(gone, goneStudy.rootId, { ...command(goneStudy.revision) });
    await expect(getProvenance(gone, goneStudy.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getProvenance(gone, goneStudy.rootId, goneCourse.id)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('serves the honest none state for a confirmed plan without a course, and pending while generating', async () => {
    const a = await actor('provenance-none');
    await grant(a);
    const study = await confirmedStudy(a);
    const none = await getProvenance(a, study.rootId);
    expect(none).toMatchObject({ state: 'none', rootId: study.rootId, revision: study.revision });
    expect(consumerDocumentOf(none)).toBeNull();
    // Mid-generation honesty: the current confirmed revision's pending row
    // serves the pending state — never an error, never a stale course.
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    const pending = await getProvenance(a, study.rootId);
    expect(pending).toMatchObject({ state: 'pending' });
    expect(consumerDocumentOf(pending)).toBeNull();
  });

  it('serves stored v1–v3 legacy courses in their real shape (single lesson / single recall view)', async () => {
    const a = await actor('provenance-legacy');
    await grant(a);
    // A legacy v1 row: single lesson, single stored recall — provenance serves
    // its real shape through the same wrap the player uses.
    const s1 = await confirmedStudy(a);
    await requestCourseGeneration(a, s1.rootId, { ...command(s1.revision) });
    await runCourseGeneration(await jobOf(a, s1.rootId));
    const c1 = await courseRowOf(a, s1.rootId);
    const v1Content = {
      lessonTitle: 'What a unit test is',
      sections: [{ text: 'A unit test isolates one behavior and asserts its outcome.', sourceRef: { extractionId: s1.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }],
      objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
      recall: { objectiveIndex: 0, sourceRef: { extractionId: s1.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' }, prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
    };
    expect(courseContentV1Schema.safeParse(v1Content).success).toBe(true);
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [c1.id, v1Content]);
    await database().query('DELETE FROM app.course_objective WHERE course_id=$1', [c1.id]);
    await database().query('INSERT INTO app.course_objective(id,course_id,position,objective) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), c1.id, 0, 'Explain arrange-act-assert']);
    const v1 = consumerDocumentOf(await getProvenance(a, s1.rootId));
    expect(v1?.immutable.units.map(unit => [unit.lesson, unit.title, unit.position])).toEqual([[1, 'What a unit test is', 0]]);
    expect(v1?.immutable.units[0].text).toBe('A unit test isolates one behavior and asserts its outcome.');
    expect(v1?.immutable.practiceItems.map(item => item.id)).toEqual(['practice:0']); // the single recall is the one-card view
    expect(v1?.immutable.objectives).toEqual([{ position: 0, text: 'Explain arrange-act-assert', version: 1 }]);
    expect(v1?.immutable.trackerItems.map(item => item.id)).toEqual(['lesson:1:reading']); // no enrichment invented
    expect(v1?.immutable.course.adaptation).toBeNull();
    expect(v1?.immutable.course.factsDigest).toBeNull();
    // A legacy v2 row: same single-recall shape, still no adaptation/digest.
    const s2 = await confirmedStudy(a);
    await requestCourseGeneration(a, s2.rootId, { ...command(s2.revision) });
    await runCourseGeneration(await jobOf(a, s2.rootId));
    const c2 = await courseRowOf(a, s2.rootId);
    const v2Content = {
      contentVersion: 2,
      lessons: [{ title: 'What a unit test is', sections: [{ text: 'A unit test isolates one behavior.', sourceRef: { extractionId: s2.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }], items: [{ id: 'lesson:1:reading', kind: 'reading', required: true, title: 'Read lesson 1: What a unit test is' }] }],
      objectives: [{ index: 0, text: 'Explain arrange-act-assert' }],
      recall: { objectiveIndex: 0, sourceRef: { extractionId: s2.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' }, prompt: 'State the three parts of a unit test.', answer: 'Arrange, act, assert.', rationale: 'Stated in the opening of notes.txt.' },
    };
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [c2.id, v2Content]);
    await database().query('DELETE FROM app.course_objective WHERE course_id=$1', [c2.id]);
    await database().query('INSERT INTO app.course_objective(id,course_id,position,objective) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), c2.id, 0, 'Explain arrange-act-assert']);
    const v2 = consumerDocumentOf(await getProvenance(a, s2.rootId));
    expect(v2?.immutable.practiceItems.map(item => item.id)).toEqual(['practice:0']);
    expect(v2?.immutable.course.adaptation).toBeNull();
    expect(v2?.immutable.course.factsDigest).toBeNull();
    // A legacy v3 row: adaptation + digest present, the late-objective recall
    // derives its own card id.
    const s3 = await confirmedStudy(a);
    await requestCourseGeneration(a, s3.rootId, { ...command(s3.revision) });
    await runCourseGeneration(await jobOf(a, s3.rootId));
    const c3 = await courseRowOf(a, s3.rootId);
    const v3Lessons = [{
      title: 'What a unit test is',
      framing: '“What a unit test is” is presented directly as your sources state it; no track-specific framing was added.',
      sections: [{ text: 'A unit test isolates one behavior and asserts its outcome.', sourceRef: { extractionId: s3.extractionIds[0], filename: 'notes.txt', locator: 'opening lines' } }],
      items: [{ id: 'lesson:1:reading', kind: 'reading' as const, required: true, title: 'Read lesson 1: What a unit test is' }],
    }];
    const v3Objectives = [{ index: 0, text: 'Explain arrange-act-assert' }, { index: 1, text: 'Explain test doubles' }];
    const v3Recall = {
      objectiveIndex: 1,
      sourceRef: { extractionId: s3.extractionIds[1], filename: 'doubles.txt', locator: 'opening lines' },
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
    await database().query('UPDATE app.generated_course SET content=$2 WHERE id=$1', [c3.id, v3Content]);
    await database().query('DELETE FROM app.course_objective WHERE course_id=$1', [c3.id]);
    for (const [position, objective] of v3Objectives.entries()) await database().query('INSERT INTO app.course_objective(id,course_id,position,objective) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), c3.id, position, objective.text]);
    const v3 = consumerDocumentOf(await getProvenance(a, s3.rootId));
    expect(v3?.immutable.practiceItems.map(item => [item.id, item.objectiveIndex])).toEqual([['practice:1', 1]]);
    expect(v3?.immutable.practiceItems[0].sourceRef.filename).toBe('doubles.txt');
    expect(v3?.immutable.objectives.map(objective => objective.text)).toEqual(['Explain arrange-act-assert', 'Explain test doubles']);
    expect(v3?.immutable.course.adaptation).toEqual({ track: 'neutral', backgroundSummary: '' });
    expect(v3?.immutable.course.factsDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is attempt-independent: submissions and tracker marks leave the document untouched; why/supplement usage grows only the derivatives block', async () => {
    const a = await actor('provenance-attempts');
    await grant(a);
    const study = await confirmedStudy(a, supplementsPlan, [textA, textB, textC]);
    await requestCourseGeneration(a, study.rootId, { ...command(study.revision) });
    await runCourseGeneration(await jobOf(a, study.rootId));
    const course = await courseRowOf(a, study.rootId);
    const before = consumerDocumentOf(await getProvenance(a, study.rootId));
    expect(before).not.toBeNull();
    if (!before) return;
    // Practice evidence rows and tracker done rows now EXIST for this owner…
    await submitPracticeCard(a, study.rootId, { ...command(study.revision), courseId: course.id, cardId: 'practice:0', attempted: 'MY DISTINCTIVE ATTEMPT TEXT 8841', assisted: false });
    await markItemDone(a, study.rootId, { ...command(study.revision), courseId: course.id, itemId: 'lesson:1:reading' });
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.practice_attempt WHERE course_id=$1', [course.id])).rows[0].count).toBe(1);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id=$1', [course.id])).rows[0].count).toBe(1);
    // …and the document is byte-identical: no attempted text, no answer, no
    // rationale, no evidence kind, no done state anywhere.
    const afterAttempts = consumerDocumentOf(await getProvenance(a, study.rootId));
    expect(JSON.stringify(afterAttempts)).toBe(JSON.stringify(before));
    for (const banned of ['MY DISTINCTIVE ATTEMPT TEXT 8841', '"answer"', '"rationale"', '"attempted"', '"evidenceKind"', '"done"', '"outcome"']) expect(JSON.stringify(afterAttempts)).not.toContain(banned);
    // Why usage and a verified supplement pass grow ONLY the derivatives block
    // — the immutable block stays byte-identical, and the derivatives may only
    // gain entries (monotonic), never rewrite or drop one.
    await requestWhyStep(a, study.rootId, { ...command(study.revision), courseId: course.id, lessonIndex: 0, depth: 1 });
    await runWhyStep(await whyJobOf(a, course.id, 0, 1));
    await requestSupplements(a, study.rootId, { ...command(study.revision), courseId: course.id });
    await runSupplementFetch(await supplementJobOf(a, course.id));
    const after = consumerDocumentOf(await getProvenance(a, study.rootId));
    expect(after).not.toBeNull();
    if (!after) return;
    expect(JSON.stringify(after.immutable)).toBe(JSON.stringify(before.immutable)); // the pin-and-compare target never moved
    expect(after.derivatives.whyExplanations).toHaveLength(1);
    expect(after.derivatives.whyExplanations[0]).toMatchObject({ lesson: 1, depth: 1, dimension: 'purpose' });
    expect(after.derivatives.whyExplanations[0].sources.length).toBeGreaterThanOrEqual(1);
    expect(after.derivatives.supplements.map(supplement => supplement.outcome)).toEqual(['supported', 'conflict', 'unsupported']);
    expect(after.derivatives.supplements[0].hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(after.derivatives.supplements[0].locator).toContain('fetched document');
    expect(after.derivatives.supplements[2]).toMatchObject({ hash: null, locator: null });
    expect(after.derivatives.supplements.length).toBeGreaterThanOrEqual(before.derivatives.supplements.length); // monotonic
    expect(after.derivatives.whyExplanations.length).toBeGreaterThanOrEqual(before.derivatives.whyExplanations.length); // monotonic
    // A no-attempt fresh study of the same plan serves the same SHAPE — the
    // document's structure is attempt-independent, not attempt-aware.
    const b = await actor('provenance-no-attempts');
    await grant(b);
    const fresh = await confirmedStudy(b, supplementsPlan, [textA, textB, textC]);
    await requestCourseGeneration(b, fresh.rootId, { ...command(fresh.revision) });
    await runCourseGeneration(await jobOf(b, fresh.rootId));
    const clean = consumerDocumentOf(await getProvenance(b, fresh.rootId));
    expect(clean).not.toBeNull();
    if (!clean) return;
    const shapeOf = (document: ProvenanceDocument) => ({
      keys: Object.keys(document).sort(),
      immutable: Object.keys(document.immutable).sort(),
      course: Object.keys(document.immutable.course).sort(),
      lineage: Object.keys(document.immutable.course.lineage).sort(),
      objectives: Object.keys(document.immutable.objectives[0]).sort(),
      units: Object.keys(document.immutable.units[0]).sort(),
      practiceItems: Object.keys(document.immutable.practiceItems[0]).sort(),
      trackerItems: Object.keys(document.immutable.trackerItems[0]).sort(),
      derivatives: Object.keys(document.derivatives).sort(),
    });
    expect(shapeOf(clean)).toEqual(shapeOf(after));
    // The usage-bearing arrays carry their contract item shapes only.
    expect(Object.keys(after.derivatives.supplements[0]).sort()).toEqual(['hash', 'locator', 'origin', 'outcome', 'position', 'retrievedAt', 'url']);
    expect(Object.keys(after.derivatives.whyExplanations[0]).sort()).toEqual(['depth', 'dimension', 'lesson', 'sources']);
    expect(clean.immutable.objectives).toEqual(after.immutable.objectives);
    expect(clean.immutable.trackerItems).toEqual(after.immutable.trackerItems);
    expect(clean.immutable.units.map(unit => [unit.lesson, unit.title, unit.position, unit.text])).toEqual(after.immutable.units.map(unit => [unit.lesson, unit.title, unit.position, unit.text]));
    expect(clean.immutable.practiceItems.map(item => [item.id, item.objectiveIndex])).toEqual(after.immutable.practiceItems.map(item => [item.id, item.objectiveIndex]));
  });
});
