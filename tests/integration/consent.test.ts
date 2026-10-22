import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import {
  getDisclosure,
  decide,
  withdraw,
  admitDispatch,
  settleDispatch,
} from '../../src/modules/processing-consent/service';
import { removeRoot } from '../../src/modules/lifecycle-platform/service';
import { createRoot, registerObject } from '../../src/modules/lifecycle-platform/repository';
import { upload, getStudy } from '../../src/modules/materials-setup/service';
import { database, closeDatabase, transaction } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity } from '../../src/contracts/setup';

// Everything here is LOCAL SYNTHETIC coverage of the S3 fail-closed boundary.
// The "processor spy" is a local counter standing in for a dispatch transport:
// it performs no I/O. Zero calls must be observable on every denied path and an
// admitted dispatch must produce exactly one tracked effect.
const spy = { calls: 0 };
const syntheticDispatch = () => {
  spy.calls += 1;
};
const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });
const stream = (value = 'Synthetic consent-test source') => new Blob([value]).stream();

async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({
    body: { email: credentials.email, password: credentials.password },
    asResponse: true,
  });
  const body = await response.json();
  const session = await database().query<{ id: string }>(
    'SELECT id FROM auth.session WHERE token=$1',
    [body.token],
  );
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}

// Disclosure revisions are immutable and monotonic; each test inserts its own
// SYNTHETIC fixture version above the current maximum so the "current
// configuration" is explicit per test. The rows are clearly labeled synthetic
// test configurations, never real provider eligibility evidence.
let nextVersion = 0;
async function admitConfiguration(eligibility: 'eligible' | 'ineligible', limit = 10) {
  if (!nextVersion) {
    const max = await database().query<{ max: number | null }>('SELECT max(version) AS max FROM app.processor_configuration');
    nextVersion = (max.rows[0].max ?? 0) + 1;
  }
  const version = nextVersion++;
  const id = crypto.randomUUID();
  await database().query(
    `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
     VALUES($1,$2,'Synthetic test spy (fixture — not compliant live AI)','Boundary test purpose','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.',$3,true,$4)`,
    [id, version, eligibility, limit],
  );
  return { id, version };
}
async function registeredObject(ownerId: string) {
  const rootId = crypto.randomUUID();
  let objectId = '';
  await transaction(async (client) => {
    await createRoot(client, ownerId, rootId);
    objectId = await registerObject(client, rootId, 'original', []);
  });
  return { rootId, objectId };
}
const count = async (sql: string, params: unknown[]) =>
  (await database().query(sql, params)).rowCount ?? 0;
// Denied-path admissions still run inside their own caller transaction so the
// content-free receipt is recorded even though nothing is dispatched.
const admit = (identity: Identity, objectIds: string[]) =>
  transaction((client) => admitDispatch(client, identity, { commandKey: crypto.randomUUID(), objectIds }));

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('fail-closed processing consent and dispatch admission', () => {
  it('never accepts a grant for an ineligible configuration, records the decline and replays it once', async () => {
    const a = await actor('consent-ineligible');
    expect((await getDisclosure(a)).decision).toBe('none');
    const ineligible = await admitConfiguration('ineligible');
    const disclosure = await getDisclosure(a);
    expect(disclosure.configuration).toMatchObject({ version: ineligible.version, eligibility: 'ineligible', syntheticTest: true });
    // allow=true cannot make an ineligible configuration dispatchable, and no
    // consent row may exist for it afterwards.
    await expect(
      decide(a, { ...command(), configurationVersion: ineligible.version, decision: 'granted', acknowledgedTerms: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect(
      await count('SELECT 1 FROM app.processing_decision WHERE owner_id=$1', [a.userId]),
    ).toBe(0);
    const decline = { ...command(), configurationVersion: ineligible.version, decision: 'declined', acknowledgedTerms: true };
    expect(await decide(a, decline)).toEqual({ decision: 'declined', disclosureVersion: ineligible.version });
    expect(await decide(a, decline)).toEqual({ decision: 'declined', disclosureVersion: ineligible.version });
    expect(
      await count('SELECT 1 FROM app.processing_decision WHERE owner_id=$1', [a.userId]),
    ).toBe(1);
    expect((await getDisclosure(a)).decision).toBe('declined');
    // A reused command key with a different request is a conflict, not a new effect.
    await expect(
      decide(a, { ...decline, decision: 'granted' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('grants only the current eligible disclosure; stale consent blocks admission with zero calls', async () => {
    const b = await actor('consent-stale');
    const first = await admitConfiguration('eligible', 10);
    await expect(
      decide(b, { ...command(), configurationVersion: first.version - 1, decision: 'granted', acknowledgedTerms: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await decide(b, { ...command(), configurationVersion: first.version, decision: 'granted', acknowledgedTerms: true })).toEqual({
      decision: 'granted',
      disclosureVersion: first.version,
    });
    const { objectId } = await registeredObject(b.userId);
    const scope = { commandKey: crypto.randomUUID(), objectIds: [objectId] };
    // Allowed synthetic path: admission inside the caller's transaction, then
    // exactly one tracked dispatch effect.
    const allowed = await transaction(async (client) => {
      const admission = await admitDispatch(client, b, scope);
      if (admission.outcome === 'admitted') syntheticDispatch();
      return admission;
    });
    expect(allowed.outcome).toBe('admitted');
    expect(spy.calls).toBe(1);
    expect(
      await database().query(
        'SELECT outcome,object_ids,settled_at FROM app.dispatch_admission WHERE id=$1',
        [allowed.admissionId],
      ),
    ).toMatchObject({ rows: [{ outcome: 'admitted', object_ids: [objectId], settled_at: null }] });
    // Disclosure change: the old grant answers nothing; the denied path calls nothing.
    await admitConfiguration('eligible', 10);
    const stale = await admit(b, [objectId]);
    expect(stale.outcome).toBe('blocked-consent');
    expect(spy.calls).toBe(1);
    expect((await getDisclosure(b)).decision).toBe('none');
  });

  it('blocks admissions beyond the configured daily quota without counting denials', async () => {
    const c = await actor('consent-quota');
    const configuration = await admitConfiguration('eligible', 2);
    expect(await decide(c, { ...command(), configurationVersion: configuration.version, decision: 'granted', acknowledgedTerms: true })).toEqual({
      decision: 'granted',
      disclosureVersion: configuration.version,
    });
    const { objectId } = await registeredObject(c.userId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const admitted = await transaction((client) =>
        admitDispatch(client, c, { commandKey: crypto.randomUUID(), objectIds: [objectId] }),
      );
      expect(admitted.outcome).toBe('admitted');
      syntheticDispatch();
    }
    const blocked = await transaction((client) =>
      admitDispatch(client, c, { commandKey: crypto.randomUUID(), objectIds: [objectId] }),
    );
    expect(blocked.outcome).toBe('blocked-quota');
    expect(spy.calls).toBe(2);
    expect(
      await count("SELECT 1 FROM app.dispatch_admission WHERE owner_id=$1 AND outcome='admitted'", [c.userId]),
    ).toBe(2);
    expect(
      await database().query('SELECT outcome FROM app.dispatch_admission WHERE id=$1', [blocked.admissionId]),
    ).toMatchObject({ rows: [{ outcome: 'blocked-quota' }] });
  });

  it('serializes withdrawal against dispatch on separate clients into one outcome with no untracked late result', async () => {
    const d = await actor('consent-race');
    const configuration = await admitConfiguration('eligible', 10);
    await decide(d, { ...command(), configurationVersion: configuration.version, decision: 'granted', acknowledgedTerms: true });
    const { objectId } = await registeredObject(d.userId);
    const before = spy.calls;
    // Separate database clients: admitDispatch row-locks the principal inside
    // its transaction; withdraw() takes the same lock, so exactly one order wins.
    const [admission, receipt] = await Promise.all([
      transaction(async (client) => {
        const result = await admitDispatch(client, d, { commandKey: crypto.randomUUID(), objectIds: [objectId] });
        if (result.outcome === 'admitted') syntheticDispatch();
        return result;
      }),
      withdraw(d, command()),
    ]);
    expect(receipt.decision).toBe('withdrawn');
    const calls = spy.calls - before;
    if (admission.outcome === 'admitted') {
      // Already-sent requests stay tracked; the late result must be rejected.
      expect(calls).toBe(1);
      expect(await settleDispatch(d, admission.admissionId)).toMatchObject({ outcome: 'rejected-late' });
    } else {
      expect(admission.outcome).toBe('blocked-withdrawn');
      expect(calls).toBe(0);
      expect(await settleDispatch(d, admission.admissionId)).toMatchObject({ outcome: 'rejected-late' });
    }
    // Any number of late-result deliveries replays the one recorded outcome.
    expect(await settleDispatch(d, admission.admissionId)).toMatchObject({ outcome: 'rejected-late' });
    expect(await count("SELECT 1 FROM app.processing_decision WHERE owner_id=$1 AND decision='withdrawn'", [d.userId])).toBe(1);
    expect(await count('SELECT 1 FROM app.dispatch_admission WHERE owner_id=$1', [d.userId])).toBe(1);
    expect((await getDisclosure(d)).decision).toBe('withdrawn');
    // A withdrawal cannot be silently reversed into a fresh grant.
    await expect(
      decide(d, { ...command(), configurationVersion: configuration.version, decision: 'granted', acknowledgedTerms: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects foreign and invalidated lineage at admission and rejects late results after deletion, idempotently', async () => {
    const e = await actor('consent-fence');
    const f = await actor('consent-foreign');
    const configuration = await admitConfiguration('eligible', 10);
    await decide(e, { ...command(), configurationVersion: configuration.version, decision: 'granted', acknowledgedTerms: true });
    const foreign = await registeredObject(f.userId);
    const foreignAttempt = await transaction((client) =>
      admitDispatch(client, e, { commandKey: crypto.randomUUID(), objectIds: [foreign.objectId] }),
    );
    expect(foreignAttempt.outcome).toBe('blocked-fence');
    const own = await registeredObject(e.userId);
    const admitted = await transaction((client) =>
      admitDispatch(client, e, { commandKey: crypto.randomUUID(), objectIds: [own.objectId] }),
    );
    expect(admitted.outcome).toBe('admitted');
    // Deleting the lineage ancestor invalidates the admitted dispatch: the late
    // result is rejected and the receipt retains the scoped IDs for purge (S9).
    await removeRoot(e, own.rootId, command(0));
    expect(await settleDispatch(e, admitted.admissionId)).toMatchObject({ outcome: 'rejected-late' });
    expect(await settleDispatch(e, admitted.admissionId)).toMatchObject({ outcome: 'rejected-late' });
    const row = (
      await database().query('SELECT outcome,settled_at,object_ids FROM app.dispatch_admission WHERE id=$1', [
        admitted.admissionId,
      ])
    ).rows[0];
    expect(row.outcome).toBe('rejected-late');
    expect(row.settled_at).not.toBeNull();
    expect(row.object_ids).toEqual([own.objectId]);
    // Concurrent duplicate settlement collapses to one accepted effect.
    const fresh = await registeredObject(e.userId);
    const live = await transaction((client) =>
      admitDispatch(client, e, { commandKey: crypto.randomUUID(), objectIds: [fresh.objectId] }),
    );
    expect(live.outcome).toBe('admitted');
    const settled = await Promise.all([settleDispatch(e, live.admissionId), settleDispatch(e, live.admissionId)]);
    expect(settled[0]).toEqual(settled[1]);
    expect(settled[0].outcome).toBe('accepted');
  });

  it('denies dispatch and withdrawal for revoked sessions without recording admissions', async () => {
    const g = await actor('consent-revoked');
    const configuration = await admitConfiguration('eligible', 10);
    await decide(g, { ...command(), configurationVersion: configuration.version, decision: 'granted', acknowledgedTerms: true });
    const { objectId } = await registeredObject(g.userId);
    await database().query('DELETE FROM auth.session WHERE id=$1', [g.sessionId]);
    await expect(
      transaction((client) => admitDispatch(client, g, { commandKey: crypto.randomUUID(), objectIds: [objectId] })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(withdraw(g, command())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await count('SELECT 1 FROM app.dispatch_admission WHERE owner_id=$1', [g.userId])).toBe(0);
  });

  it('withdraws without any external effect and leaves manual work fully usable', async () => {
    const h = await actor('consent-manual');
    const uploaded = await upload(h, command(), 'consent-manual.txt', stream());
    const configuration = await admitConfiguration('eligible', 10);
    await decide(h, { ...command(), configurationVersion: configuration.version, decision: 'granted', acknowledgedTerms: true });
    const receipt = await withdraw(h, command());
    expect(receipt.decision).toBe('withdrawn');
    expect((await getDisclosure(h)).decision).toBe('withdrawn');
    // Saved manual work is untouched by withdrawal; extraction stays a local
    // operation and no purge of personal work is implied.
    const study = await getStudy(h, uploaded.rootId);
    expect(study.rootId).toBe(uploaded.rootId);
    expect(study.slots[0].state).toBe('queued');
  });
});
