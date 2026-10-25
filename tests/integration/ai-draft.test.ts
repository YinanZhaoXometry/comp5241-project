import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { getDisclosure, decide, withdraw } from '../../src/modules/processing-consent/service';
import { removeRoot } from '../../src/modules/lifecycle-platform/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestAiDraft, getAiDraft } from '../../src/modules/ai-setup/service';
import { runAiDraft } from '../../src/modules/ai-setup/worker';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { AiDraftJob } from '../../src/contracts/ai-setup';
import type { TextCompletionPort, TextCompletionResult } from '../../src/contracts/ai-provider';

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });

// LOCAL SYNTHETIC coverage of the S6 owner-admitted AI draft pipeline. The
// completion "provider" is an injected fake port — zero network calls happen
// here; the live endpoint is exercised only by the manual smoke script.

const plan: Plan = {
  topic: 'Unit testing fundamentals', goal: 'Understand a topic', clarification: '',
  outcomes: ['Explain arrange-act-assert'],
  miniCourse: { title: 'Unit testing basics', lessons: ['What a unit test is'], practice: 'Write one test for a pure function', estimatedMinutes: 30 },
  missingExplanations: 'Sources do not cover mock frameworks.',
};
const validDraft = JSON.stringify({ topics: ['Unit testing', 'Assertions', 'Test doubles'], plan });
const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
const portOf = (result: TextCompletionResult): () => TextCompletionPort | null => {
  const port: TextCompletionPort = { complete: async () => result };
  return () => port;
};
const okPort = portOf({ ok: true, text: validDraft, provenance: { requestedModel: 'k3', returnedModel: 'k3-fake' }, usage });
const noPort = () => null;

async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({ body: { email: credentials.email, password: credentials.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>('SELECT id FROM auth.session WHERE token=$1', [body.token]);
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}

async function grant(identity: Identity) {
  const disclosure = await getDisclosure(identity);
  await decide(identity, { ...command(), configurationVersion: disclosure.configuration.version, decision: 'granted', acknowledgedTerms: true });
}

// Acknowledged single-source batch: the AI request's admission scope.
async function acknowledgedStudy(identity: Identity, text = 'Synthetic AI-draft test source about unit testing fundamentals.') {
  const slotId = crypto.randomUUID();
  const batch = await createBatch(identity, { ...command(), inputs: [{ slotId, filename: 'notes.txt', mime: 'text/plain', byteLength: Buffer.byteLength(text) }] });
  const uploaded = await uploadSlot(identity, batch.rootId, slotId, command(), new Blob([text]).stream());
  await runExtraction(uploaded.operationId!);
  const preview = await getBatch(identity, batch.rootId);
  const slot = preview.slots.find(item => item.slotId === slotId);
  if (!slot?.extractionId) throw new Error('fixture setup failed: slot never reached preview');
  await acknowledge(identity, batch.rootId, { ...command(preview.revision), selected: [{ slotId, extractionId: slot.extractionId, acknowledged: true as const }], excluded: [] });
  return getBatch(identity, batch.rootId);
}

async function jobOf(identity: Identity, rootId: string): Promise<AiDraftJob> {
  const row = await database().query<{ id: string; root_id: string; admission_id: string }>(
    'SELECT id,root_id,admission_id FROM app.ai_draft_request WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at DESC LIMIT 1',
    [identity.userId, rootId],
  );
  if (!row.rows[0]) throw new Error('no draft request row');
  return { schemaVersion: 1, requestId: row.rows[0].id, admissionId: row.rows[0].admission_id, rootId: row.rows[0].root_id, ownerId: identity.userId, sessionId: identity.sessionId };
}

const draftRows = (ownerId: string) =>
  database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.ai_draft_request WHERE owner_id=$1', [ownerId]);
const ledgerTotal = (ownerId: string) =>
  database().query<{ total: number }>('SELECT COALESCE(sum(total_tokens),0)::int AS total FROM app.ai_dispatch_ledger WHERE owner_id=$1', [ownerId]);

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('owner-admitted AI draft pipeline', () => {
  it('admits, dispatches through the injected port and lands an advisory draft the Manual flow still owns', async () => {
    const a = await actor('ai-draft-happy');
    await grant(a);
    const study = await acknowledgedStudy(a);
    const receipt = await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    expect(receipt.state).toBe('pending');
    await runAiDraft(await jobOf(a, study.rootId), okPort);
    const draft = await getAiDraft(a, study.rootId);
    expect(draft.status).toBe('ready');
    expect(draft.result?.topics).toHaveLength(3);
    expect(draft.result?.plan.topic).toBe('Unit testing fundamentals');
    expect(draft.model).toBe('k3-fake');
    expect(draft.usage).toEqual(usage);
    expect((await ledgerTotal(a.userId)).rows[0].total).toBe(150);
    // The draft is advisory: the Manual save/confirm path works unchanged.
    const saved = await savePlan(a, study.rootId, { ...command(study.revision), plan, extractionId: study.selection!.sources[0].extractionId!, selectionId: study.selection!.id });
    await confirmPlan(a, study.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    expect((await getAiDraft(a, study.rootId)).status).toBe('ready'); // unchanged by the Manual confirm
  });

  it('replays one command to exactly one request and one effect', async () => {
    const a = await actor('ai-draft-replay');
    await grant(a);
    const study = await acknowledgedStudy(a);
    const envelope = { ...command(study.revision) };
    const first = await requestAiDraft(a, study.rootId, envelope);
    const second = await requestAiDraft(a, study.rootId, envelope);
    expect(second).toEqual(first);
    expect((await draftRows(a.userId)).rows[0].count).toBe(1);
    await runAiDraft(await jobOf(a, study.rootId), okPort);
    await runAiDraft(await jobOf(a, study.rootId), okPort); // duplicate delivery: idempotent no-op
    expect((await ledgerTotal(a.userId)).rows[0].total).toBe(150);
    expect((await getAiDraft(a, study.rootId)).status).toBe('ready');
  });

  it('blocks dispatch without consent and records no request', async () => {
    const a = await actor('ai-draft-declined');
    const study = await acknowledgedStudy(a);
    await expect(requestAiDraft(a, study.rootId, { ...command(study.revision) })).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await draftRows(a.userId)).rows[0].count).toBe(0);
  });

  it('discards the provider reply when consent is withdrawn while the job runs', async () => {
    const a = await actor('ai-draft-withdrawn');
    await grant(a);
    const study = await acknowledgedStudy(a);
    await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    const job = await jobOf(a, study.rootId);
    await withdraw(a, command());
    await runAiDraft(job, okPort);
    const draft = await getAiDraft(a, study.rootId);
    expect(draft.status).toBe('failed');
    expect(draft.failureCode).toBe('rejected-late');
    expect(draft.result).toBeNull();
    expect((await ledgerTotal(a.userId)).rows[0].total).toBe(0);
  });

  it('rejects a malformed model reply instead of guessing a plan', async () => {
    const a = await actor('ai-draft-invalid');
    await grant(a);
    const study = await acknowledgedStudy(a);
    await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    await runAiDraft(await jobOf(a, study.rootId), portOf({ ok: true, text: 'Here is your plan — trust me', provenance: { requestedModel: 'k3', returnedModel: 'k3-fake' }, usage }));
    expect((await getAiDraft(a, study.rootId)).failureCode).toBe('invalid-output');
    expect((await ledgerTotal(a.userId)).rows[0].total).toBe(0);
  });

  it('fails honestly with no provider configured and on provider errors', async () => {
    const a = await actor('ai-draft-noprovider');
    await grant(a);
    const study = await acknowledgedStudy(a);
    await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    await runAiDraft(await jobOf(a, study.rootId), noPort);
    expect((await getAiDraft(a, study.rootId)).failureCode).toBe('provider-unavailable');

    const b = await actor('ai-draft-rate-limit');
    await grant(b);
    const studyB = await acknowledgedStudy(b);
    await requestAiDraft(b, studyB.rootId, { ...command(studyB.revision) });
    await runAiDraft(await jobOf(b, studyB.rootId), portOf({ ok: false, error: { code: 'rate-limit', message: 'Provider rate limit reached.', outcome: 'rejected' } }));
    expect((await getAiDraft(b, studyB.rootId)).failureCode).toBe('rate-limit');
    expect((await ledgerTotal(b.userId)).rows[0].total).toBe(0);
  });

  it('refuses to dispatch once the owner token budget is exhausted', async () => {
    const a = await actor('ai-draft-budget');
    await grant(a);
    const study = await acknowledgedStudy(a);
    await database().query(
      'INSERT INTO app.ai_dispatch_ledger(id,owner_id,request_id,input_tokens,output_tokens,total_tokens) VALUES($1,$2,NULL,$3,$4,$5)',
      [crypto.randomUUID(), a.userId, 1_999_999, 0, 1_999_999],
    );
    await expect(requestAiDraft(a, study.rootId, { ...command(study.revision) })).rejects.toMatchObject({ code: 'AI_BUDGET_EXHAUSTED' });
    expect((await draftRows(a.userId)).rows[0].count).toBe(0);
  });

  it('discards the result when the study root is deleted while the job runs', async () => {
    const a = await actor('ai-draft-deleted');
    await grant(a);
    const study = await acknowledgedStudy(a);
    await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    const job = await jobOf(a, study.rootId);
    await removeRoot(a, study.rootId, command(study.revision));
    await runAiDraft(job, okPort);
    // The root is gone: the request row itself is purged with the root, so the
    // owner-scoped read denies rather than resurrecting anything.
    await expect(getAiDraft(a, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await ledgerTotal(a.userId)).rows[0].total).toBe(0);
  });

  it('denies another owner any read of the draft', async () => {
    const a = await actor('ai-draft-owner-a');
    const b = await actor('ai-draft-owner-b');
    await grant(a);
    const study = await acknowledgedStudy(a);
    await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    await expect(getAiDraft(b, study.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
  });

  it('enforces the daily admission quota as a hard request bound', async () => {
    const a = await actor('ai-draft-quota');
    // Fixture configuration with a one-request daily limit; clearly labeled
    // synthetic, exactly like the S3 consent fixtures.
    const max = await database().query<{ max: number }>('SELECT max(version) AS max FROM app.processor_configuration');
    await database().query(
      `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
       VALUES($1,$2,'Synthetic test spy (fixture — not compliant live AI)','Boundary test purpose','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.','eligible',true,1)`,
      [crypto.randomUUID(), max.rows[0].max + 1],
    );
    await grant(a); // grants against the fixture configuration that is now current
    const study = await acknowledgedStudy(a);
    await requestAiDraft(a, study.rootId, { ...command(study.revision) });
    const second = await acknowledgedStudy(a, 'Second synthetic source for the quota fixture.');
    await expect(requestAiDraft(a, second.rootId, { ...command(second.revision) })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await draftRows(a.userId)).rows[0].count).toBe(1);
  });
});
