import { afterAll, describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestCourseGeneration, getCourse, markItemDone } from '../../src/modules/course-generation/service';
import { runCourseGeneration } from '../../src/modules/course-generation/worker';
import {
  getAssessment,
  startTest,
  submitAttempt,
  startRetest,
  submitRetest,
  flagAssessmentItem,
  startReplacement,
  submitReplacement,
  getAssessmentHandoff,
} from '../../src/modules/assessment-progress/service';
import { insertParentManifest } from '../../src/modules/assessment-progress/repository';
import {
  removeRoot,
  personalRemoval,
  dependenciesPreview,
  reconcileCopies,
} from '../../src/modules/lifecycle-platform/service';
import { assertObjects } from '../../src/modules/lifecycle-platform/repository';
import { registerLifecyclePort, unregisterLifecyclePort, registeredPorts } from '../../src/modules/lifecycle-platform/derivatives';
import { requestExport, downloadExport, listExports } from '../../src/modules/setup-export/service';
import { runExport } from '../../src/modules/setup-export/worker';
import { reconcileRetention } from '../../src/modules/lifecycle-platform/retention';
import { database, closeDatabase, transaction } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AttemptSnapshot, ReplacementSnapshot, RetestSnapshot } from '../../src/contracts/assessment';
import type { Manifest } from '../../src/contracts/export';

// LOCAL SYNTHETIC coverage of epic-3 story 9 (assessment lifecycle, ownership
// and deletion integration) — the ticket's verify scenarios through the REAL
// verbs: root and whole-personal deletion fence in-flight attempt grading and
// retest/replacement generation (no late-recommitted result, immediate denial
// on the next read), the registered port purges every assessment derivative
// kind completely and idempotently inside the seven-day deadline (including
// the parent-path award rows no CASCADE ever reaches), the owner export
// contains their attempt/score/recovery history while another actor's
// download is denied, and duplicate lifecycle commands yield one tracked
// effect.
//
// NOTE (2026-10-29): AUTHORED, NOT EXECUTED in this lane phase — the shared
// DB cluster is reserved for the serialized full gate the orchestrator runs;
// the orchestrator merges this lane, runs migrations (unchanged set) and
// executes this suite. The registration/contract/phrasing/retention-pin
// halves are unit-covered in tests/unit/assessment-lifecycle.test.ts to
// de-risk that run. Real PostgreSQL; the processor is the local synthetic
// fixture — zero network, and the assessment/lifecycle machinery dispatches
// nothing.

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
  const response = await auth().api.signInEmail({
    body: { email: credentials.email, password: credentials.password },
    asResponse: true,
  });
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
async function readyStudyWithRequiredDone(label: string, studyPlan: Plan = plan) {
  const identity = await actor(label);
  await grant(identity);
  const study = await confirmedStudy(identity, studyPlan);
  const course = await generateCourse(identity, study.rootId, study.revision);
  for (const item of course.course.items.filter(item => item.required))
    await markItemDone(identity, study.rootId, { ...command(study.revision), courseId: course.course.courseId, itemId: item.id });
  return { identity, study, course };
}

// The honest 79.96% boundary failure (correct on items 1-4, wrong on the
// 2004-point fifth) — the borderline fixture that opens the recovery chain.
async function failAtBoundary(identity: Identity, rootId: string, revision: number) {
  const started = await startTest(identity, rootId, { ...command(revision) });
  const snapshot = await snapshotOf(started.operationId);
  const graded = await submitAttempt(identity, rootId, started.operationId, { ...command(revision), attemptId: started.operationId, answers: answersFrom(snapshot, [5]) });
  expect(graded.passed).toBe(false);
  expect(graded.displayPercent).toBe('79.96%');
  return { attemptId: started.operationId, graded, snapshot };
}

// The one open boundary target of the boundary fixture (the 3.7 integration
// record: this fixture's only open group is the fifth item's).
async function openTargetOf(identity: Identity, rootId: string) {
  const state = await getAssessment(identity, rootId);
  const target = state.recovery?.targets.find(item => item.status === 'open');
  if (!target) throw new Error('no open recovery target');
  return target.objectiveIndex;
}

// Content-free emptiness check across every assessment table for one root or
// owner; the generation counter is looked up owner-side always (it has no
// root column) and is only expected empty in PERSONAL scope — a root purge
// leaves the owner's budget accounting intact by design (the
// ai_dispatch_ledger precedent).
const ASSESSMENT_TABLES = [
  'test_attempt',
  'retest_attempt',
  'recovery_target',
  'completion_award',
  'assessment_flag',
  'item_dispute',
  'assessment_replacement',
  'studied_release',
] as const;
async function assessmentCounts(column: 'root_id' | 'owner_id', value: string) {
  const counts: Record<string, number> = {};
  for (const table of ASSESSMENT_TABLES) {
    const rows = await database().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM app.${table} WHERE ${column}=$1`,
      [value],
    );
    counts[table] = rows.rows[0].count;
  }
  const ownerId = column === 'owner_id'
    ? value
    : (await database().query<{ owner_id: string }>('SELECT owner_id FROM app.lifecycle_root WHERE id=$1', [value])).rows[0]!.owner_id;
  const use = await database().query<{ count: number }>(
    'SELECT count(*)::int AS count FROM app.assessment_generation_use WHERE owner_id=$1',
    [ownerId],
  );
  counts['assessment_generation_use'] = use.rows[0].count;
  return counts;
}

function category(preview: { categories: Array<{ key: string; count: number }> }, key: string) {
  return preview.categories.find(item => item.key === key);
}

// Synthetic tar decoder (the export-suite one); returns name -> content.
function decodeArtifact(input: Buffer) {
  if (input[0] !== 0x1f || input[1] !== 0x8b) throw new Error('Artifact is not gzip');
  const tar = new Uint8Array(gunzipSync(input));
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset < tar.length) {
    const block = tar.subarray(offset, offset + 512);
    offset += 512;
    if (block.every(byte => byte === 0)) break;
    const name = new TextDecoder().decode(block.subarray(0, 100)).replace(/\0.*$/u, '');
    const size = parseInt(new TextDecoder().decode(block.subarray(124, 136)).replace(/\0.*/u, '').trim(), 8);
    entries.set(name, tar.subarray(offset, offset + size));
    offset += size + ((512 - (size % 512)) % 512);
  }
  return entries;
}

// personalRemoval is a discriminated union by body: preview in, receipt in.
type PersonalReceipt = {
  requestId: string;
  commandKey: string;
  state: string;
  acceptedAt: string;
  deadlineAt: string;
  purgedAt: string | null;
};
type DependencyPreviewShape = { scope: string; categories: Array<{ key: string; count: number }> };
const asPreview = (value: Awaited<ReturnType<typeof personalRemoval>>) => value as unknown as DependencyPreviewShape;
const asReceipt = (value: Awaited<ReturnType<typeof personalRemoval>>) => value as unknown as PersonalReceipt;

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('epic-3 story-9: assessment lifecycle, ownership and deletion integration', () => {
  it('deletion previews count every assessment derivative category honestly and journal content-free counts only', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('alife-preview');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    // The full chain: an open retest on the fixture's only open boundary
    // target, a flagged disputed item and an open corrected replacement.
    const openIndex = await openTargetOf(a, study.rootId);
    const startedRetest = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [openIndex] });
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    const disputed = await getAssessment(a, study.rootId);
    const disputeId = disputed.disputes[0]!.disputeId;
    const startedReplacement = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId });
    expect(startedRetest.state).toBe('active');
    expect(startedReplacement.state).toBe('active');

    const preview = await dependenciesPreview(a, study.rootId, { schemaVersion: 1 });
    // Every derivative kind this epic persists is counted (guidance has no
    // stored copy; the studied-release pointer is counted at zero here — no
    // switch ever moved it).
    expect(category(preview, 'assessment-attempts')).toMatchObject({ count: 1 });
    expect(category(preview, 'assessment-retests')).toMatchObject({ count: 1 });
    expect(category(preview, 'assessment-recovery-ledger')!.count).toBeGreaterThanOrEqual(1);
    expect(category(preview, 'assessment-awards')).toMatchObject({ count: 0 });
    expect(category(preview, 'assessment-flags')).toMatchObject({ count: 1 });
    expect(category(preview, 'assessment-disputes')).toMatchObject({ count: 1 });
    expect(category(preview, 'assessment-replacements')).toMatchObject({ count: 1 });
    expect(category(preview, 'assessment-release-pointers')).toMatchObject({ count: 0 });
    // The journal stores category counts only — never prompt, answer or plan
    // text (the S9 content-free contract).
    const journal = await database().query<{ categories: unknown }>(
      'SELECT categories FROM app.deletion_preview WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1',
      [study.rootId],
    );
    expect(journal.rows).toHaveLength(1);
    const serialized = JSON.stringify(journal.rows[0].categories);
    expect(serialized).not.toContain('Arrange');
    expect(serialized).not.toContain('Unit testing');
    // The personal preview carries the same owner-scoped categories.
    const personal = asPreview(await personalRemoval(a, { schemaVersion: 1, preview: true }));
    expect(category(personal, 'assessment-attempts')).toMatchObject({ count: 1 });
    expect(category(personal, 'assessment-disputes')).toMatchObject({ count: 1 });
    // Cross-owner preview denial: another actor sees nothing of this root.
    const b = await actor('alife-preview-other');
    await expect(dependenciesPreview(b, study.rootId, { schemaVersion: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('root deletion fences an in-flight attempt: immediate denial on every read, no late grading commit, complete purge, sibling intact', async () => {
    const { identity: a, study: keeper } = await readyStudyWithRequiredDone('alife-root-race');
    // The keeper study carries its own open attempt (rows that must survive).
    const keeperAttempt = await startTest(a, keeper.rootId, { ...command(keeper.revision) });
    // The doomed study: required work done, one OPEN attempt racing deletion.
    const doomed = await confirmedStudy(a, { ...plan, topic: 'Doomed raced study' });
    const doomedCourse = await generateCourse(a, doomed.rootId, doomed.revision);
    for (const item of doomedCourse.course.items.filter(item => item.required))
      await markItemDone(a, doomed.rootId, { ...command(doomed.revision), courseId: doomedCourse.course.courseId, itemId: item.id });
    const started = await startTest(a, doomed.rootId, { ...command(doomed.revision) });
    const snapshot = await snapshotOf(started.operationId);

    // Deletion accepted while the attempt is open.
    const deletion = command(doomed.revision);
    const receipt = await removeRoot(a, doomed.rootId, deletion);
    expect(receipt.state).toBe('pending');

    // Immediate denial on the next read of EVERY path: the submit (no late
    // grading commit), the assessment view, the 3.8 handoff read, a retest
    // start and a fresh attempt start.
    await expect(
      submitAttempt(a, doomed.rootId, started.operationId, { ...command(doomed.revision), attemptId: started.operationId, answers: answersFrom(snapshot) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getAssessment(a, doomed.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getAssessmentHandoff(a, doomed.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(startRetest(a, doomed.rootId, { ...command(doomed.revision), attemptId: started.operationId, targetIndexes: [1] })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(startTest(a, doomed.rootId, { ...command(doomed.revision) })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Nothing was graded by the denied submit: the open attempt still has no
    // graded state, and the purge below removes it entirely.
    const openRow = await database().query<{ status: string }>('SELECT status FROM app.test_attempt WHERE id=$1', [started.operationId]);
    expect(openRow.rows[0]?.status ?? 'gone').not.toBe('graded');

    // Duplicate lifecycle command: one tracked effect (identical receipt).
    expect(await removeRoot(a, doomed.rootId, deletion)).toEqual(receipt);

    // The reconciler completes the purge inside the deadline: every
    // assessment table empty for the doomed root, and the content-free
    // generation counter shows the owner consumed nothing (attempt starts
    // are never counted).
    await reconcileCopies();
    await reconcileCopies();
    const counts = await assessmentCounts('root_id', doomed.rootId);
    for (const [table, count] of Object.entries(counts))
      expect(count, `${table} must purge with the root`).toBe(0);
    // The sibling keeper study stands: its open attempt is still served.
    const kept = await getAssessment(a, keeper.rootId);
    if (kept.state !== 'active' || !kept.attempt) throw new Error('keeper attempt must still be open after the sibling deletion');
    expect(kept.attempt.attemptId).toBe(keeperAttempt.operationId);
  });

  it('root deletion fences open retest and replacement generation, purges the dispute chain and the parent-path award residue', async () => {
    const { identity: a, study, course } = await readyStudyWithRequiredDone('alife-chain-race');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    // Open retest on the fixture's open boundary target.
    const openIndex = await openTargetOf(a, study.rootId);
    const retest = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [openIndex] });
    const retestSnapshot = await retestSnapshotOf(retest.operationId);
    // Under-review dispute with an open corrected replacement.
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    const disputed = await getAssessment(a, study.rootId);
    const replacement = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId: disputed.disputes[0]!.disputeId });
    const replacementSnapshot = await replacementSnapshotOf(replacement.operationId);
    // A planted parent-path award row (course_id NULL): the row the course
    // CASCADE can never reach — only the port deletes it with the root.
    const client = await database().connect();
    try {
      await insertParentManifest(client, {
        id: crypto.randomUUID(),
        manifestId: crypto.randomUUID(),
        ownerId: a.userId,
        rootId: study.rootId,
        manifest: { schemaVersion: 1, children: [{ courseId: course.course.courseId, required: true }] },
      });
    } finally {
      await client.release();
    }
    const parentRow = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.completion_award WHERE root_id=$1 AND kind='parent-path'", [study.rootId]);
    expect(parentRow.rows[0].count).toBe(1);

    // Deletion accepted while the retest, dispute and replacement are open.
    await removeRoot(a, study.rootId, command(study.revision));
    // Late generation submissions deny: nothing re-commits into the revoked
    // lineage (the retest grade, the replacement grade — both fenced).
    await expect(
      submitRetest(a, study.rootId, retest.operationId, { ...command(study.revision), retestId: retest.operationId, answers: answersFrom(retestSnapshot) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(
      submitReplacement(a, study.rootId, replacement.operationId, { ...command(study.revision), replacementId: replacement.operationId, answers: answersFrom(replacementSnapshot) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    await reconcileCopies();
    const counts = await assessmentCounts('root_id', study.rootId);
    for (const table of ASSESSMENT_TABLES)
      expect(counts[table], `${table} must purge with the root`).toBe(0);
    // The content-free generation counter is the ONE deliberate survivor of
    // a root purge (owner accounting — the ai_dispatch_ledger precedent):
    // the retest and replacement starts consumed it before the deletion.
    const used = await database().query<{ used: number }>('SELECT used FROM app.assessment_generation_use WHERE owner_id=$1', [a.userId]);
    expect(used.rows[0]!.used).toBeGreaterThanOrEqual(2);
  });

  it('a grade that committed BEFORE deletion purges with the root; replays and synthetic late recommits deny', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('alife-grade-first');
    const started = await startTest(a, study.rootId, { ...command(study.revision) });
    const snapshot = await snapshotOf(started.operationId);
    const submit = { ...command(study.revision), attemptId: started.operationId, answers: answersFrom(snapshot) };
    const graded = await submitAttempt(a, study.rootId, started.operationId, submit);
    expect(graded.passed).toBe(true);
    // The pass awarded completion (the contributing-verb pattern).
    const awarded = await getAssessment(a, study.rootId);
    expect(awarded.currentAward).not.toBeNull();

    // Deletion AFTER the grade: replaying the SAME submit command (the
    // exact late-recommit channel) denies — a deleted root never serves a
    // graded view again, and no re-derived result lands.
    await removeRoot(a, study.rootId, command(study.revision));
    await expect(submitAttempt(a, study.rootId, started.operationId, submit)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    // The lineage fence rejects a synthetic late recommit directly (the
    // lifecycle-suite pattern): the plan revision's object was invalidated
    // with the root, so nothing keyed to it may commit.
    await expect(
      transaction(client => assertObjects(client, a.userId, [study.planRevisionId])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });

    await reconcileCopies();
    const counts = await assessmentCounts('root_id', study.rootId);
    expect(counts['completion_award']).toBe(0);
    expect(counts['test_attempt']).toBe(0);
  });

  it('whole-personal removal purges every assessment table owner-wide (generation counter included) under the registered deletion clock, while another actor stands', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('alife-personal');
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    const openIndex = await openTargetOf(a, study.rootId);
    await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [openIndex] });
    const second = await confirmedStudy(a, { ...plan, topic: 'Second personal study' });
    const secondCourse = await generateCourse(a, second.rootId, second.revision);
    for (const item of secondCourse.course.items.filter(item => item.required))
      await markItemDone(a, second.rootId, { ...command(second.revision), courseId: secondCourse.course.courseId, itemId: item.id });
    await startTest(a, second.rootId, { ...command(second.revision) });

    const key = command(0);
    const receipt = asReceipt(await personalRemoval(a, key));
    expect(receipt.state).toBe('pending');
    // Denial is durable before the accepted request returned.
    await expect(getAssessment(a, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(getAssessmentHandoff(a, second.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // Replay: one tracked effect (same request identity), never a second.
    expect(await personalRemoval(a, key)).toMatchObject({ requestId: receipt.requestId });

    // The retention clock that covers the derivative purge: the scheduler's
    // inventory sync registers the accepted deletion under the seven-day
    // deletion-active-purge class (retention.ts syncRetentionInventory — the
    // registry row is the scheduler's own backfill, not the verb's write),
    // and it is not yet overdue, so no alert is recorded.
    await reconcileRetention();
    const registry = await database().query<{ retention_class: string; state: string; alerted_at: Date | null }>(
      "SELECT retention_class,state,alerted_at FROM app.retention_registry WHERE kind='deletion-request' AND row_id=$1",
      [receipt.requestId],
    );
    expect(registry.rows[0]).toMatchObject({ retention_class: 'deletion-active-purge', state: 'active', alerted_at: null });
    // Past the deadline without a completed purge the same clock alerts —
    // the enforcement visibility the scheduler owns (clock manipulation via
    // SQL UPDATE, the retention-suite precedent; never the system clock).
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE kind='deletion-request' AND row_id=$1", [receipt.requestId]);
    await reconcileRetention();
    const alerted = await database().query<{ alerted_at: Date | null }>(
      "SELECT alerted_at FROM app.retention_registry WHERE kind='deletion-request' AND row_id=$1",
      [receipt.requestId],
    );
    expect(alerted.rows[0]!.alerted_at).not.toBeNull();

    // The reconciler completes the purge: EVERY assessment table empty for
    // the owner — generation counter included in personal scope.
    await reconcileCopies();
    await reconcileCopies();
    const counts = await assessmentCounts('owner_id', a.userId);
    for (const [table, count] of Object.entries(counts))
      expect(count, `${table} must purge with the account`).toBe(0);
    const purged = asReceipt(await personalRemoval(a, key));
    expect(purged).toMatchObject({ requestId: receipt.requestId, state: 'purged' });
    // Another actor's assessment data stands untouched.
    const { identity: c, study: studyC } = await readyStudyWithRequiredDone('alife-personal-other');
    await startTest(c, studyC.rootId, { ...command(studyC.revision) });
    const kept = await getAssessment(c, studyC.rootId);
    if (kept.state !== 'active' || !kept.attempt) throw new Error("another actor's study must stand after a's personal removal");
    expect(kept.attempt.attemptId).toBeTruthy();
  });

  it('the owner export carries attempt/score/recovery history with the deleted-root scope honored and another actor download denied', async () => {
    const { identity: a, study, course } = await readyStudyWithRequiredDone('alife-export');
    // Live root: the boundary failure, its ledger, a cleared retest, a
    // dispute with its clearing replacement, and (through the contributing
    // verbs) the completion award — the widest honest history one study
    // carries.
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    const openIndex = await openTargetOf(a, study.rootId);
    const retest = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [openIndex] });
    const retestSnapshot = await retestSnapshotOf(retest.operationId);
    await submitRetest(a, study.rootId, retest.operationId, { ...command(study.revision), retestId: retest.operationId, answers: answersFrom(retestSnapshot) });
    await flagAssessmentItem(a, study.rootId, { ...command(study.revision), evidenceKind: 'attempt', evidenceId: attemptId, position: 5 });
    const disputed = await getAssessment(a, study.rootId);
    const replacement = await startReplacement(a, study.rootId, { ...command(study.revision), disputeId: disputed.disputes[0]!.disputeId });
    const replacementSnapshot = await replacementSnapshotOf(replacement.operationId);
    await submitReplacement(a, study.rootId, replacement.operationId, { ...command(study.revision), replacementId: replacement.operationId, answers: answersFrom(replacementSnapshot) });
    const completed = await getAssessment(a, study.rootId);
    expect(completed.currentAward).not.toBeNull();

    // A second study of the SAME owner, then deleted: its assessment rows
    // must be excluded by snapshot scope exactly like every other class.
    const doomed = await confirmedStudy(a, { ...plan, topic: 'Doomed export study' });
    const doomedCourse = await generateCourse(a, doomed.rootId, doomed.revision);
    for (const item of doomedCourse.course.items.filter(item => item.required))
      await markItemDone(a, doomed.rootId, { ...command(doomed.revision), courseId: doomedCourse.course.courseId, itemId: item.id });
    const doomedAttempt = await startTest(a, doomed.rootId, { ...command(doomed.revision) });
    await removeRoot(a, doomed.rootId, command(doomed.revision));
    await reconcileCopies();

    // The pre-request preview is honest: live owner counts, the deliberate
    // generation-counter skip note.
    const preview = await listExports(a);
    const evidenceInfo = preview.categories.find(item => item.category === 'assessment-evidence')!;
    expect(evidenceInfo.available).toBe(true);
    expect(evidenceInfo.count).toBeGreaterThanOrEqual(1);
    const skipNote = preview.categories.find(item => item.category === 'assessment-generation-use')!;
    expect(skipNote.available).toBe(true);
    expect(skipNote.note).toContain('deliberately excluded');

    // Build and decode the real artifact.
    const key = command();
    const request = await requestExport(a, key);
    expect(request.state).toBe('queued');
    await runExport(request.operationId!);
    const row = await database().query<{ state: string; manifest: Manifest }>('SELECT state,manifest FROM app.export_request WHERE id=$1', [request.operationId!]);
    expect(row.rows[0].state).toBe('ready');
    const manifest = row.rows[0].manifest;
    const assessmentEntries = manifest.entries.filter(entry => entry.category === 'assessment-evidence');
    expect(assessmentEntries.length).toBeGreaterThanOrEqual(5);
    expect(assessmentEntries.every(entry => entry.rootId !== doomed.rootId)).toBe(true);
    expect(assessmentEntries.every(entry => entry.rootId === study.rootId)).toBe(true);
    // The manifest lineage convention: course-linked rows parent to their
    // course; the fence set never gains assessment entries (unit-pinned).
    expect(assessmentEntries.some(entry => entry.parents.length === 1 && entry.parents[0] === course.course.courseId)).toBe(true);
    const skip = manifest.skipped.find(item => item.category === 'assessment-generation-use');
    expect(skip?.reason).toContain('content-free');
    const response = await downloadExport(a, request.rootId, new AbortController().signal);
    const entries = decodeArtifact(Buffer.from(await response.arrayBuffer()));
    // Attempt payload: the full stored row — snapshot, integer points and
    // the honest 79.96% boundary (7996/10000) — owner derivative content.
    const attempts = JSON.parse(new TextDecoder().decode(entries.get('assessments/attempts.json')!)) as { rows: Array<{ id: string; status: string; passed: boolean | null; earned_points: number | null; snapshot: { items: unknown[] } }> };
    const gradedRow = attempts.rows.find(item => item.id === attemptId);
    expect(gradedRow).toMatchObject({ status: 'graded', passed: false });
    expect(gradedRow!.earned_points).toBe(7996);
    expect(gradedRow!.snapshot.items.length).toBeGreaterThan(0);
    expect(attempts.rows.every(item => item.id !== doomedAttempt.operationId)).toBe(true);
    const ledger = JSON.parse(new TextDecoder().decode(entries.get('assessments/recovery-ledger.json')!)) as { rows: Array<{ status: string; objective_index: number }> };
    expect(ledger.rows.length).toBeGreaterThanOrEqual(1);
    const awards = JSON.parse(new TextDecoder().decode(entries.get('assessments/awards.json')!)) as { rows: Array<{ kind: string; awarded_at: string | null }> };
    expect(awards.rows.some(item => item.kind === 'mini-course' && item.awarded_at)).toBe(true);
    const disputes = JSON.parse(new TextDecoder().decode(entries.get('assessments/disputes.json')!)) as { rows: Array<{ status: string }> };
    expect(disputes.rows.some(item => item.status === 'corrected')).toBe(true);
    // Another actor's download of this artifact denies at the fence.
    const b = await actor('alife-export-other');
    await expect(downloadExport(b, request.rootId, new AbortController().signal)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('the assessment port purges a RECOVERED chain standalone-FK-safe: the cleared-ledger order holds without the course cascade (review disposition 2026-10-29)', async () => {
    const { identity: a, study } = await readyStudyWithRequiredDone('alife-recovered-purge');
    // The epic's core recovered shape: boundary failure opens the ledger, a
    // graded clearing retest satisfies the group (recovery_target.cleared_by
    // now references that retest — the FK the pre-disposition delete order
    // violated) and the completion award lands on the recovered chain.
    const { attemptId } = await failAtBoundary(a, study.rootId, study.revision);
    const openIndex = await openTargetOf(a, study.rootId);
    const retest = await startRetest(a, study.rootId, { ...command(study.revision), attemptId, targetIndexes: [openIndex] });
    const retestSnapshot = await retestSnapshotOf(retest.operationId);
    await submitRetest(a, study.rootId, retest.operationId, { ...command(study.revision), retestId: retest.operationId, answers: answersFrom(retestSnapshot) });
    const completed = await getAssessment(a, study.rootId);
    expect(completed.currentAward).not.toBeNull();

    // Prove the port's OWN delete order: unregister the course port so its
    // CASCADE cannot empty the assessment tables first — with the
    // pre-disposition order this purge violates recovery_target's cleared_by
    // FK; with the ledger-first order it completes. The port re-registers in
    // the finally so later journeys keep the full registry.
    const coursePort = registeredPorts().find(port => port.name === 'course-generation')!;
    unregisterLifecyclePort('course-generation');
    try {
      await removeRoot(a, study.rootId, command(study.revision));
      await reconcileCopies();
      await reconcileCopies();
    } finally {
      registerLifecyclePort(coursePort);
    }
    const counts = await assessmentCounts('root_id', study.rootId);
    for (const [table, count] of Object.entries(counts))
      if (table !== 'assessment_generation_use')
        expect(count, `${table} must purge standalone with the root`).toBe(0);
    // The content-free counter deliberately SURVIVES the root purge (journey
    // 3's design proof): this journey's clearing retest consumed one unit.
    const counter = await database().query<{ used: number }>('SELECT used FROM app.assessment_generation_use WHERE owner_id=$1', [a.userId]);
    expect(counter.rows[0]?.used ?? 0).toBeGreaterThanOrEqual(1);
    // The unregistered course port left the course rows behind (its own
    // suite proves its coverage): clean the now-parentless course rows so
    // the shared database carries no orphans from this ordering probe.
    await database().query('DELETE FROM app.generated_course WHERE root_id=$1', [study.rootId]);
    await expect(getAssessment(a, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });
});
