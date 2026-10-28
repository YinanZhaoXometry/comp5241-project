import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide, withdraw } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestAiCheck, getAiDraft } from '../../src/modules/ai-setup/service';
import { runAiDraft } from '../../src/modules/ai-setup/worker';
import { getCheckState, takeCheck, submitItem, finishCheck } from '../../src/modules/setup-diagnostic/service';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AiDraftJob } from '../../src/contracts/ai-setup';
import type { TextCompletionPort, TextCompletionResult } from '../../src/contracts/ai-provider';

// LOCAL SYNTHETIC coverage of the S7 take-path closure: AI generation of the
// 3–5-item starting check through the SAME admission/settle machinery, landing
// as a standard diagnostic bundle the unchanged take/submit/finish flow runs
// on. The completion "provider" is an injected fake port — zero network calls.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

const plan: Plan = {
  topic: 'Unit testing fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const validItems = JSON.stringify({ items: [
  { objectiveIndex: 0, sourcePosition: 0, prompt: 'Which structure states the expected outcome?', choices: [{ id: 'a', text: 'Arrange' }, { id: 'b', text: 'Assert' }], answerId: 'b', rationale: 'Assert checks the expected outcome.' },
  { objectiveIndex: 1, sourcePosition: 0, prompt: 'A test double stands in for what?', choices: [{ id: 'a', text: 'A dependency' }, { id: 'b', text: 'The test runner' }], answerId: 'a', rationale: 'The source says a double stands in for a dependency.' },
  { objectiveIndex: 2, sourcePosition: 0, prompt: 'Coverage proves assertions were meaningful?', choices: [{ id: 'a', text: 'Yes, always' }, { id: 'b', text: 'No — it reports executed lines' }], answerId: 'b', rationale: 'The source says coverage reports executed lines only.' },
] });
const usage = { inputTokens: 200, outputTokens: 90, totalTokens: 290 };
const portOf = (result: TextCompletionResult): () => TextCompletionPort | null => {
  const port: TextCompletionPort = { complete: async () => result };
  return () => port;
};

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
  const textA = 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.';
  const textB = 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.';
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
  return getBatch(identity, batch.rootId);
}

async function jobOf(identity: Identity, rootId: string): Promise<AiDraftJob> {
  const row = await database().query<{ id: string; root_id: string; admission_id: string }>(
    "SELECT id,root_id,admission_id FROM app.ai_draft_request WHERE owner_id=$1 AND root_id=$2 AND kind='check' ORDER BY created_at DESC LIMIT 1",
    [identity.userId, rootId],
  );
  if (!row.rows[0]) throw new Error('no check request row');
  return { schemaVersion: 1, requestId: row.rows[0].id, admissionId: row.rows[0].admission_id, rootId: row.rows[0].root_id, ownerId: identity.userId, sessionId: identity.sessionId, kind: 'check' };
}

const okPort = portOf({ ok: true, text: validItems, provenance: { requestedModel: 'k3', returnedModel: 'k3-fake' }, usage });

// The processor_configuration table is shared, ordered state: sibling suites'
// fixtures (e.g. consent.test's ineligible boundary rows) can leave the
// current version ineligible. Grant against the current version when it is
// eligible; otherwise pin this file's own clearly-labeled eligible fixture
// above it — the same pattern consent.test.ts uses.
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

describe('S7 take-path closure: AI-generated starting check', () => {
  it('generates a validated bundle the unchanged take/submit/finish flow runs on, with no credit anywhere', async () => {
    const a = await actor('ai-check-happy');
    await grant(a);
    const study = await confirmedStudy(a);
    expect((await getCheckState(a, study.rootId)).status).toBe('offered');
    const receipt = await requestAiCheck(a, study.rootId, { ...command(study.revision) });
    expect(receipt.state).toBe('pending');
    await runAiDraft(await jobOf(a, study.rootId), okPort);
    // The bundle IS the check: state turns active with the AI source named.
    const after = await getCheckState(a, study.rootId);
    expect(after.status).toBe('active');
    expect(after.source).toBe('ai-generated');
    expect(after.items).toHaveLength(3);
    // No leakage before submission: prompts/choices only, answers withheld.
    expect(after.items.every(item => item.evidence === null)).toBe(true);
    // Take reuses the generated bundle rather than shadowing it.
    const taken = await takeCheck(a, study.rootId, { ...command(study.revision) });
    expect(taken.bundleId).toBe(after.bundleId);
    const state = await getCheckState(a, study.rootId);
    // Submit two items; one correct one wrong; answers revealed only now.
    const first = await submitItem(a, study.rootId, state.bundleId!, { ...command(study.revision), position: 1, choiceId: 'b', assistance: 'unaided' });
    expect(first.outcome).toBe('correct');
    expect(first.rationale).toContain('outcome');
    const second = await submitItem(a, study.rootId, state.bundleId!, { ...command(study.revision), position: 2, choiceId: 'b', assistance: 'unaided' });
    expect(second.outcome).toBe('incorrect');
    const finished = await finishCheck(a, study.rootId, state.bundleId!, { ...command(study.revision) });
    expect(finished).toMatchObject({ path: 'check-finish', submitted: 2, unknown: 1 });
    // No completion/score/credit column exists anywhere in the evidence.
    const evidence = await database().query(`SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='diagnostic_evidence'`);
    const columns = evidence.rows.map(row => row.column_name as string);
    expect(columns.some(column => /score|grade|credit|completion/.test(column))).toBe(false);
  });

  it('requires a confirmed plan and consent; nothing generates without both', async () => {
    const a = await actor('ai-check-declined');
    const study = await confirmedStudy(a);
    await expect(requestAiCheck(a, study.rootId, { ...command(study.revision) })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const rows = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.ai_draft_request WHERE owner_id=$1 AND kind='check'", [a.userId]);
    expect(rows.rows[0].count).toBe(0);
    // Unconfirmed plans never even reach admission.
    const b = await actor('ai-check-unconfirmed');
    const slotId = crypto.randomUUID();
    const batch = await createBatch(b, { ...command(), inputs: [{ slotId, filename: 'x.txt', mime: 'text/plain', byteLength: 8 }] });
    await expect(requestAiCheck(b, batch.rootId, { ...command() })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('discards generated items when consent is withdrawn mid-flight and never inserts a bundle', async () => {
    const a = await actor('ai-check-withdrawn');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestAiCheck(a, study.rootId, { ...command(study.revision) });
    const job = await jobOf(a, study.rootId);
    await withdraw(a, command());
    await runAiDraft(job, okPort);
    expect((await getAiDraft(a, study.rootId, 'check')).failureCode).toBe('rejected-late');
    const bundles = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.diagnostic_bundle WHERE root_id=$1', [study.rootId]);
    expect(bundles.rows[0].count).toBe(0);
  });

  it('rejects unparseable or unresolvable items honestly instead of repairing them', async () => {
    const a = await actor('ai-check-invalid');
    await grant(a);
    const study = await confirmedStudy(a);
    await requestAiCheck(a, study.rootId, { ...command(study.revision) });
    await runAiDraft(await jobOf(a, study.rootId), portOf({ ok: true, text: 'Trust me, three good questions follow.', provenance: { requestedModel: 'k3', returnedModel: 'k3-fake' }, usage }));
    expect((await getAiDraft(a, study.rootId, 'check')).failureCode).toBe('invalid-output');
    const bundles = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.diagnostic_bundle WHERE root_id=$1', [study.rootId]);
    expect(bundles.rows[0].count).toBe(0);
  });

  it('replays one command to one request and one bundle', async () => {
    const a = await actor('ai-check-replay');
    await grant(a);
    const study = await confirmedStudy(a);
    const envelope = { ...command(study.revision) };
    const first = await requestAiCheck(a, study.rootId, envelope);
    expect(await requestAiCheck(a, study.rootId, envelope)).toEqual(first);
    await runAiDraft(await jobOf(a, study.rootId), okPort);
    await runAiDraft(await jobOf(a, study.rootId), okPort); // duplicate delivery: bundle exists, no second insert
    const bundles = await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.diagnostic_bundle WHERE root_id=$1', [study.rootId]);
    expect(bundles.rows[0].count).toBe(1);
    const ledger = await database().query<{ total: number }>('SELECT COALESCE(sum(total_tokens),0)::int AS total FROM app.ai_dispatch_ledger WHERE owner_id=$1', [a.userId]);
    expect(ledger.rows[0].total).toBe(290);
  });
});
