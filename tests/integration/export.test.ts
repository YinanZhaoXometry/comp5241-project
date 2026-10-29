import { afterAll, describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { database, closeDatabase, transaction } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import { upload, getStudy, savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { requestHash } from '../../src/platform/commands';
import { acknowledge } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { removeRoot, reconcileCopies } from '../../src/modules/lifecycle-platform/service';
import { objectsActive } from '../../src/modules/lifecycle-platform/repository';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { createBatch, uploadSlot, getBatch } from '../../src/modules/materials-setup/batches';
import { requestCourseGeneration, requestSupplements, requestWhyStep, submitPracticeCard } from '../../src/modules/course-generation/service';
import { runCourseGeneration, runSupplementFetch, runWhyStep } from '../../src/modules/course-generation/worker';
import { requestExport, downloadExport, listExports } from '../../src/modules/setup-export/service';
import { runExport, sweepExports } from '../../src/modules/setup-export/worker';
import { purgeExportRoots, exportRootsForOwner } from '../../src/modules/setup-export/repository';
import { config } from '../../src/platform/config';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { CourseJob, SupplementJob, WhyJob } from '../../src/contracts/courses';
import { canonical, type Manifest } from '../../src/contracts/export';

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });
const text = 'Synthetic export fixture: arrange, act, assert. <script>not executable</script>';
const stream = (value = text) => new Blob([value]).stream();
const manual: Plan = {
  topic: 'Unit testing',
  goal: 'Apply a skill',
  clarification: '',
  outcomes: ['Write a deterministic unit test'],
  miniCourse: { title: 'First test', lessons: ['Arrange, act, assert'], practice: 'Test an addition function', estimatedMinutes: 20 },
  missingExplanations: 'Coverage not assessed. No supplementary source fetched.',
};
async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({ body: { email: credentials.email, password: credentials.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>('SELECT id FROM auth.session WHERE token=$1', [body.token]);
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}
async function seededStudy(label: string, data = text) {
  const owner = await actor(label);
  const receipt = await upload(owner, command(), `${label}.txt`, stream(data));
  await runExtraction(receipt.operationId!, async input => input);
  let study = await getStudy(owner, receipt.rootId);
  await acknowledge(owner, receipt.rootId, {
    ...command(study.revision),
    selected: [{ slotId: study.slots[0].slotId, extractionId: study.extractionId!, acknowledged: true }],
    excluded: [],
  });
  study = await getStudy(owner, receipt.rootId);
  const saved = await savePlan(owner, receipt.rootId, { ...command(study.revision), plan: manual, extractionId: study.extractionId!, selectionId: study.selection!.id });
  const confirmed = await confirmPlan(owner, receipt.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
  return { owner, receipt, confirmed };
}
async function readyExport(owner: Identity) {
  const key = command();
  const receipt = await requestExport(owner, key);
  expect(receipt.state).toBe('queued');
  await runExport(receipt.operationId!);
  const rows = await database().query<Record<string, unknown>>('SELECT * FROM app.export_request WHERE id=$1', [receipt.operationId!]);
  expect(rows.rows).toHaveLength(1);
  return { key, receipt, row: asRow(rows.rows[0]) };
}
async function responseBody(response: Response) {
  return Buffer.from(await response.arrayBuffer());
}
type RequestRow = {
  id: string;
  state: string;
  manifest: Manifest | null;
  manifest_hash: string | null;
  artifact_object_id: string | null;
  artifact_key: string | null;
  artifact_bytes: number | null;
  expires_at: Date | null;
};
function asRow(record: Record<string, unknown>): RequestRow {
  return record as unknown as RequestRow;
}
// Synthetic tar decoder mirroring the unit-suite one; returns name -> content.
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
afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('authenticated consistent personal-setup export', () => {
  it('builds one consistent ready artifact, replays duplicate commands and never includes other owners', async () => {
    const a = await seededStudy('export-a');
    const b = await seededStudy('export-b', 'Second owner synthetic marker that must never travel');
    const { key, receipt, row } = await readyExport(a.owner);
    expect(row.state).toBe('ready');
    expect(row.manifest_hash).toBeTruthy();
    expect(row.artifact_bytes).toBeGreaterThan(0);
    expect(row.artifact_object_id).toBeTruthy();
    expect(row.expires_at!.getTime()).toBeGreaterThan(Date.now() + 24 * 3600 * 1000 - 60000);
    expect(row.expires_at!.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000 + 60000);
    // Duplicate command replays one receipt; worker reruns stay single-artifact.
    expect(await requestExport(a.owner, key)).toEqual(receipt);
    await runExport(receipt.operationId!);
    expect((await database().query('SELECT count(*)::int AS n FROM app.export_request WHERE owner_id=$1', [a.owner.userId])).rows[0].n).toBe(1);
    expect((await database().query("SELECT count(*)::int AS n FROM app.lifecycle_object WHERE root_id=$1 AND kind='export'", [receipt.rootId])).rows[0].n).toBe(1);
    // Manifest: complete owner-A inventory, zero owner-B rows, honest labels.
    const manifest = row.manifest!;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.requestId).toBe(receipt.rootId);
    expect(manifest.manifestHash).toBe(requestHash(canonical({ requestId: receipt.rootId, capturedAt: manifest.capturedAt, entries: manifest.entries, skipped: manifest.skipped })));
    const categories = new Map<string, string[]>();
    for (const entry of manifest.entries) {
      const list = categories.get(entry.category) ?? [];
      list.push(entry.objectId);
      categories.set(entry.category, list);
    }
    for (const category of ['originals', 'extractions', 'selections', 'plans', 'confirmations'])
      expect(categories.get(category)!.length).toBeGreaterThanOrEqual(1);
    const foreign = await database().query<{ id: string }>('SELECT o.id AS id FROM app.lifecycle_object o JOIN app.lifecycle_root r ON r.id=o.root_id WHERE r.owner_id=$1', [b.owner.userId]);
    expect(manifest.entries.some(entry => foreign.rows.some(item => item.id === entry.objectId))).toBe(false);
    // Integrated deployment: P1's receipt tables are owner-scoped and
    // inventoried; the diagnostic bundle/item tables key by root/bundle rather
    // than owner, so exactly those two are skipped — deliberately, as the
    // answer-key item bank is not owner content — while the owner-scoped
    // diagnostic evidence is captured.
    // Epic-2 S8 flipped generated-courses, practice-evidence and
    // why-explanations INTO the artifact (owner derivative content), so the
    // skip set is exactly: the two diagnostic answer-key tables, advisory AI
    // drafts, and fetched supplement passages. Epic-3 3.9 adds the one
    // assessment skip: the content-free daily generation counter (owner
    // accounting, not study content — the attempts/retests/replacements it
    // counted ship under assessment-evidence).
    expect(manifest.skipped.map(item => item.category)).toEqual(['diagnostic-evidence', 'diagnostic-evidence', 'ai-drafts', 'supplements', 'assessment-generation-use']);
    expect(manifest.skipped.filter(item => item.category === 'diagnostic-evidence').every(item => item.reason.includes('Deliberately excluded') && item.reason.includes('answer keys'))).toBe(true);
    // Epic-3 3.9: the generation counter's exclusion is deliberate and says
    // why (content-free resource accounting), naming where the counted
    // evidence does ship.
    expect(manifest.skipped.find(item => item.category === 'assessment-generation-use')!.reason).toContain('content-free');
    expect(manifest.skipped.find(item => item.category === 'assessment-generation-use')!.reason).toContain('assessment-evidence');
    // S6: advisory AI drafts are deliberately excluded (suggestions, not owner
    // content); no excerpt or provider reply ever enters the artifact.
    expect(manifest.skipped.find(item => item.category === 'ai-drafts')!.reason).toContain('Deliberately excluded');
    // Epic-2 S8: fetched supplement passages stay the one deliberate class
    // skip — external-source content, not owner material; only their
    // identity/location metadata rides along inside each exported course.
    expect(manifest.skipped.find(item => item.category === 'supplements')!.reason).toContain('Deliberately excluded');
    expect(manifest.skipped.find(item => item.category === 'supplements')!.reason).toContain('external-source content');
    expect(manifest.skipped.find(item => item.category === 'supplements')!.reason).toContain('not owner material');
    // Every storage key in the manifest is a real registered copy of this owner.
    const withKeys = manifest.entries.filter(entry => entry.storageKey);
    expect(withKeys.length).toBeGreaterThanOrEqual(2);
    for (const entry of withKeys)
      expect((await database().query('SELECT 1 FROM app.lifecycle_object WHERE id=$1 AND storage_key=$2', [entry.objectId, entry.storageKey])).rowCount).toBe(1);
    // Preview: live category counts and honest absent-table labels.
    const preview = await listExports(a.owner);
    expect(preview.categories.find(item => item.category === 'originals')).toMatchObject({ count: 1, available: true });
    expect(preview.categories.find(item => item.category === 'diagnostic-evidence')).toMatchObject({ count: null, available: true });
    expect(preview.requests[0]).toMatchObject({ id: receipt.rootId, state: 'ready' });
    // Authenticated download: no-store, attachment, real gzip tar content.
    const response = await downloadExport(a.owner, receipt.rootId, new AbortController().signal);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-type')).toBe('application/gzip');
    const artifact = await responseBody(response);
    const entries = decodeArtifact(artifact);
    expect(entries.has('manifest.json')).toBe(true);
    const manifestCopy = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!)) as Manifest;
    expect(manifestCopy.manifestHash).toBe(manifest.manifestHash);
    expect([...entries.keys()].filter(name => name.startsWith('originals/'))).toHaveLength(1);
    const originalEntry = manifest.entries.find(entry => entry.category === 'originals')!;
    expect(new TextDecoder().decode(entries.get(`originals/${originalEntry.objectId}.bin`)!)).toBe(text);
    const planEntry = manifest.entries.find(entry => entry.category === 'plans')!;
    expect((JSON.parse(new TextDecoder().decode(entries.get(`plans/${planEntry.objectId}.json`)!)) as { plan: Plan }).plan.topic).toBe('Unit testing');
    // Artifact identity is unreachable for anyone else and for bogus ids.
    expect(await transaction(client => objectsActive(client, b.owner.userId, [row.artifact_object_id!]))).toBe(false);
    await expect(downloadExport(b.owner, receipt.rootId, new AbortController().signal)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(downloadExport(a.owner, crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    // The single physical copy sits in private storage keyed by UUID, never a URL.
    expect((await readdir(config().storagePath)).filter(name => name === row.artifact_key)).toHaveLength(1);
  });

  it('cancels when deletion lands between capture and commit; a later export excludes the deleted root', async () => {
    const seeded = await seededStudy('export-del');
    const key = command();
    const receipt = await requestExport(seeded.owner, key);
    let reached!: () => void;
    let release!: () => void;
    const atBuild = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const running = runExport(receipt.operationId!, async () => { reached(); await resume; });
    await atBuild;
    await removeRoot(seeded.owner, seeded.receipt.rootId, command(seeded.confirmed.revision));
    release();
    await running;
    const row = asRow((await database().query('SELECT * FROM app.export_request WHERE id=$1', [receipt.operationId!])).rows[0]);
    expect(row.state).toBe('canceled');
    expect(row.artifact_object_id).toBeNull();
    expect(row.manifest).toBeNull();
    expect((await database().query("SELECT count(*)::int AS n FROM app.lifecycle_object WHERE root_id=$1 AND kind='export'", [receipt.rootId])).rows[0].n).toBe(0);
    expect((await readdir(config().storagePath)).includes(row.artifact_key!)).toBe(false);
    await expect(downloadExport(seeded.owner, receipt.rootId, new AbortController().signal)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await reconcileCopies();
    // Deleted-root fixture: a fresh export inventories only surviving lineage.
    const next = await readyExport(seeded.owner);
    expect(next.row.state).toBe('ready');
    expect(next.row.manifest!.entries.some(entry => entry.rootId === seeded.receipt.rootId)).toBe(false);
    expect(next.row.manifest!.entries.filter(entry => entry.category === 'originals')).toHaveLength(0);
    const response = await downloadExport(seeded.owner, next.receipt.rootId, new AbortController().signal);
    expect((await responseBody(response)).length).toBeGreaterThan(0);
    expect((await listExports(seeded.owner)).categories.find(item => item.category === 'originals')!.count).toBe(0);
  });

  it('cancels and discards late output when the session is revoked mid-build', async () => {
    const seeded = await seededStudy('export-revoke');
    const receipt = await requestExport(seeded.owner, command());
    let reached!: () => void;
    let release!: () => void;
    const atBuild = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const running = runExport(receipt.operationId!, async () => { reached(); await resume; });
    await atBuild;
    await database().query('DELETE FROM auth.session WHERE id=$1', [seeded.owner.sessionId]);
    release();
    await running;
    const row = asRow((await database().query('SELECT * FROM app.export_request WHERE id=$1', [receipt.operationId!])).rows[0]);
    expect(row.state).toBe('canceled');
    expect(row.artifact_object_id).toBeNull();
    expect((await readdir(config().storagePath)).includes(row.artifact_key!)).toBe(false);
    await expect(downloadExport(seeded.owner, receipt.rootId, new AbortController().signal)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('enforces expiry at download and purges the copy exactly once via the sweep', async () => {
    const seeded = await seededStudy('export-expiry');
    const { receipt, row } = await readyExport(seeded.owner);
    await database().query("UPDATE app.export_request SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [receipt.rootId]);
    await expect(downloadExport(seeded.owner, receipt.rootId, new AbortController().signal)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await database().query('SELECT state FROM app.export_request WHERE id=$1', [receipt.rootId])).rows[0].state).toBe('expired');
    expect((await readdir(config().storagePath)).includes(row.artifact_key!)).toBe(false);
    await sweepExports();
    await sweepExports();
    const swept = asRow((await database().query('SELECT * FROM app.export_request WHERE id=$1', [receipt.rootId])).rows[0]);
    expect(swept.state).toBe('expired');
    expect(swept.artifact_key).toBeNull();
    expect((await readdir(config().storagePath)).includes(row.artifact_key!)).toBe(false);
    // A crashed builder's stale running request fails honestly instead of hanging.
    const stuck = await requestExport(seeded.owner, command());
    await runExport(stuck.operationId!); // completes normally first
    await database().query("UPDATE app.export_request SET state='running',updated_at=clock_timestamp()-interval '31 minutes' WHERE id=$1", [stuck.rootId]);
    await sweepExports();
    expect((await database().query('SELECT state,failure_reason FROM app.export_request WHERE id=$1', [stuck.rootId])).rows[0]).toMatchObject({ state: 'failed', failure_reason: 'service' });
  });

  it('reauthorizes every download chunk and stops mid-stream after revocation', async () => {
    const big = Buffer.from(randomBytes(400000)).toString('base64'); // incompressible, > 128 KiB stored
    const seeded = await seededStudy('export-stream', big);
    const { receipt } = await readyExport(seeded.owner);
    const response = await downloadExport(seeded.owner, receipt.rootId, new AbortController().signal);
    const reader = response.body!.getReader();
    expect((await reader.read()).value!.length).toBe(65536);
    await database().query('DELETE FROM auth.session WHERE id=$1', [seeded.owner.sessionId]);
    await expect(reader.read()).rejects.toThrow('This item is unavailable');
    reader.releaseLock();
  });

  it('pins the snapshot at capture: a material uploaded mid-build needs another export', async () => {
    const seeded = await seededStudy('export-pin');
    const receipt = await requestExport(seeded.owner, command());
    let reached!: () => void;
    let release!: () => void;
    const atBuild = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const running = runExport(receipt.operationId!, async () => { reached(); await resume; });
    await atBuild;
    const late = await upload(seeded.owner, command(), 'late.txt', stream('Late synthetic arrival'));
    await runExtraction(late.operationId!, async input => input);
    release();
    await running;
    const row = asRow((await database().query('SELECT * FROM app.export_request WHERE id=$1', [receipt.operationId!])).rows[0]);
    expect(row.state).toBe('ready');
    expect(row.manifest!.entries.filter(entry => entry.category === 'originals')).toHaveLength(1);
    const preview = await listExports(seeded.owner);
    expect(preview.categories.find(item => item.category === 'originals')!.count).toBe(2);
    await removeRoot(seeded.owner, late.rootId, command(1));
  });

  it('caps concurrent pending exports and fences replayed foreign command keys', async () => {
    const seeded = await seededStudy('export-cap');
    for (let index = 0; index < 3; index += 1) expect((await requestExport(seeded.owner, command())).state).toBe('queued');
    await expect(requestExport(seeded.owner, command())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // A command key already used by another action can never silently re-export.
    const usedKey = (await database().query<{ command_key: string }>("SELECT command_key FROM app.command_receipt WHERE owner_id=$1 AND action<>'request-export' LIMIT 1", [seeded.owner.userId])).rows[0].command_key;
    await expect(requestExport(seeded.owner, { schemaVersion: 1, commandKey: usedKey, expectedRevision: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(requestExport(seeded.owner, { schemaVersion: 2, commandKey: crypto.randomUUID(), expectedRevision: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // Only the owner sees their own requests; the second owner sees none.
    const other = await actor('export-cap-other');
    expect((await listExports(other)).requests).toHaveLength(0);
    expect((await listExports(seeded.owner)).requests.filter(item => item.state === 'queued')).toHaveLength(3);
  });

  it('exposes module-owned purge ports for the lifecycle coordinator', async () => {
    const seeded = await seededStudy('export-purge');
    const { receipt } = await readyExport(seeded.owner);
    expect(await transaction(client => exportRootsForOwner(client, seeded.owner.userId))).toContain(receipt.rootId);
    await transaction(client => purgeExportRoots(client, [receipt.rootId]));
    expect((await database().query('SELECT 1 FROM app.export_request WHERE id=$1', [receipt.rootId])).rowCount).toBe(0);
    expect(await transaction(client => exportRootsForOwner(client, seeded.owner.userId))).not.toContain(receipt.rootId);
  });

  // -------------------------------------------------------------------------
  // Epic-2 S8: the recorded export scope decision, asserted end-to-end through
  // the real artifact. Generated courses (full stored content INCLUDING the
  // recall answers — the owner can already reveal them by submitting), typed
  // practice evidence and why explanations join the artifact; fetched
  // supplement passages stay the one deliberate class skip with their
  // identity/location metadata riding along inside the course payload;
  // deleted roots are excluded by snapshot scope exactly like every class.
  // -------------------------------------------------------------------------
  it('includes course content, practice evidence and why explanations honestly; supplements skip with reason; deleted roots excluded', async () => {
    const owner = await actor('export-s8');
    // Pin this test's own clearly-labeled synthetic fixture configuration:
    // suite order can leave a low-quota fixture current (ai-draft's quota
    // probe inserts a one-request limit), and this test admits several
    // dispatches under one owner.
    const maxVersion = await database().query<{ max: number }>('SELECT max(version) AS max FROM app.processor_configuration');
    await database().query(
      `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
       VALUES($1,$2,'Synthetic test spy (fixture — not compliant live AI)','Boundary test purpose','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.','eligible',true,100)`,
      [crypto.randomUUID(), maxVersion.rows[0].max + 1],
    );
    const disclosure = await getDisclosure(owner);
    await decide(owner, { ...command(), configurationVersion: disclosure.configuration.version, decision: 'granted', acknowledgedTerms: true });
    const textA = 'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.';
    const textB = 'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.';
    const canonicalAnswer = 'Unit testing checks a single unit of behavior.';
    const gapPlan: Plan = {
      topic: 'Unit testing',
      goal: 'Understand a topic',
      clarification: '',
      outcomes: ['Explain arrange-act-assert', 'Explain test doubles', 'Judge coverage reports'],
      miniCourse: { title: 'First test', lessons: ['Arrange, act, assert'], practice: 'Test an addition function', estimatedMinutes: 20 },
      // The S2 gap markers: supported, conflict and unsupported fixtures.
      missingExplanations: 'Sources do not cover mock frameworks. A conflicting statement about coverage and assertion quality appears in public documentation. One unverifiable claim exists about coverage.',
    };
    const derivativeStudy = async (label: string, data: string[]) => {
      const slotIds = data.map(() => crypto.randomUUID());
      const batch = await createBatch(owner, { ...command(), inputs: data.map((value, index) => ({ slotId: slotIds[index], filename: `${label}-${index}.txt`, mime: 'text/plain', byteLength: Buffer.byteLength(value) })) });
      for (const [index, value] of data.entries()) {
        const up = await uploadSlot(owner, batch.rootId, slotIds[index], command(), new Blob([value]).stream());
        await runExtraction(up.operationId!, async input => input);
      }
      const preview = await getBatch(owner, batch.rootId);
      const slots = preview.slots.filter(slot => slotIds.includes(slot.slotId));
      if (slots.length !== data.length || slots.some(slot => !slot.extractionId)) throw new Error('fixture setup failed');
      await acknowledge(owner, batch.rootId, {
        ...command(preview.revision),
        selected: slots.map(slot => ({ slotId: slot.slotId, extractionId: slot.extractionId!, acknowledged: true as const })),
        excluded: [],
      });
      const acknowledged = await getBatch(owner, batch.rootId);
      const saved = await savePlan(owner, batch.rootId, { ...command(acknowledged.revision), plan: gapPlan, extractionId: acknowledged.selection!.sources[0].extractionId, selectionId: acknowledged.selection!.id });
      const confirmed = await confirmPlan(owner, batch.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
      return { owner, rootId: batch.rootId, revision: confirmed.revision };
    };
    const live = await derivativeStudy('s8-live', [textA, textB]);
    // Generate, practice, supplement, why — the full derivative set.
    await requestCourseGeneration(live.owner, live.rootId, { ...command(live.revision) });
    const courseJob = (await database().query<{ id: string; root_id: string; admission_id: string }>(
      'SELECT id,root_id,admission_id FROM app.generated_course WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1', [live.rootId],
    )).rows[0];
    await runCourseGeneration({ schemaVersion: 1, requestId: courseJob.id, admissionId: courseJob.admission_id, rootId: courseJob.root_id, ownerId: live.owner.userId, sessionId: live.owner.sessionId } satisfies CourseJob);
    const courseId = (await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE root_id=$1 AND status='ready'", [live.rootId])).rows[0].id;
    await submitPracticeCard(live.owner, live.rootId, { ...command(live.revision), courseId, cardId: 'practice:0', attempted: 'arrange first', assisted: false });
    await submitPracticeCard(live.owner, live.rootId, { ...command(live.revision), courseId, cardId: 'practice:1', attempted: 'a standing double', assisted: true });
    await requestSupplements(live.owner, live.rootId, { ...command(live.revision), courseId });
    const supplementJob = (await database().query<{ id: string; root_id: string; admission_id: string }>(
      'SELECT id,root_id,admission_id FROM app.supplement_request WHERE course_id=$1 ORDER BY created_at DESC LIMIT 1', [courseId],
    )).rows[0];
    await runSupplementFetch({ schemaVersion: 1, requestId: supplementJob.id, admissionId: supplementJob.admission_id, courseId, rootId: supplementJob.root_id, ownerId: live.owner.userId, sessionId: live.owner.sessionId } satisfies SupplementJob);
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1', [courseId])).rows[0].count).toBe(3);
    for (const depth of [1, 2]) {
      await requestWhyStep(live.owner, live.rootId, { ...command(live.revision), courseId, lessonIndex: 0, depth });
      const whyRow = (await database().query<{ id: string; root_id: string; admission_id: string }>(
        'SELECT id,root_id,admission_id FROM app.why_explanation WHERE course_id=$1 AND lesson_index=0 AND depth=$2', [courseId, depth],
      )).rows[0];
      await runWhyStep({ schemaVersion: 1, requestId: whyRow.id, admissionId: whyRow.admission_id, courseId, rootId: whyRow.root_id, ownerId: live.owner.userId, sessionId: live.owner.sessionId, lessonIndex: 0, depth } satisfies WhyJob);
    }
    // A second study of the SAME owner, then deleted: its derivatives must be
    // excluded by snapshot scope exactly like every other class.
    const doomed = await derivativeStudy('s8-doomed', ['Doomed synthetic study that must not survive the snapshot.', 'A second doomed source so the fixture parses.']);
    await requestCourseGeneration(owner, doomed.rootId, { ...command(doomed.revision) });
    const doomedJob = (await database().query<{ id: string; root_id: string; admission_id: string }>(
      'SELECT id,root_id,admission_id FROM app.generated_course WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1', [doomed.rootId],
    )).rows[0];
    await runCourseGeneration({ schemaVersion: 1, requestId: doomedJob.id, admissionId: doomedJob.admission_id, rootId: doomedJob.root_id, ownerId: owner.userId, sessionId: owner.sessionId } satisfies CourseJob);
    const doomedCourse = (await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE root_id=$1 AND status='ready'", [doomed.rootId])).rows[0].id;
    await submitPracticeCard(owner, doomed.rootId, { ...command(doomed.revision), courseId: doomedCourse, cardId: 'practice:0', attempted: 'doomed attempt', assisted: false });
    await removeRoot(owner, doomed.rootId, { ...command(doomed.revision) });
    await reconcileCopies();
    // Live preview counts are honest after the deletion (deleted root out).
    const preview = await listExports(owner);
    expect(preview.categories.find(item => item.category === 'generated-courses')).toMatchObject({ count: 1, available: true });
    expect(preview.categories.find(item => item.category === 'practice-evidence')).toMatchObject({ count: 2, available: true });
    expect(preview.categories.find(item => item.category === 'why-explanations')).toMatchObject({ count: 2, available: true });
    expect(preview.categories.find(item => item.category === 'supplements')).toMatchObject({ count: null, available: true });
    expect(preview.categories.find(item => item.category === 'supplements')!.note).toContain('deliberately excluded');
    // Build and decode the real artifact.
    const { receipt, row } = await readyExport(owner);
    expect(row.state).toBe('ready');
    const manifest = row.manifest!;
    expect(manifest.entries.filter(entry => entry.category === 'generated-courses').map(entry => entry.rootId)).toEqual([live.rootId]);
    expect(manifest.entries.filter(entry => entry.category === 'practice-evidence')).toHaveLength(2);
    expect(manifest.entries.filter(entry => entry.category === 'why-explanations')).toHaveLength(2);
    expect(manifest.entries.every(entry => entry.rootId !== doomed.rootId)).toBe(true);
    expect(manifest.skipped.find(item => item.category === 'supplements')!.reason).toContain('external-source content');
    const response = await downloadExport(owner, receipt.rootId, new AbortController().signal);
    const entries = decodeArtifact(Buffer.from(await response.arrayBuffer()));
    // Course payload: full stored content INCLUDING the recall answers (owner
    // derivative content — the owner can already reveal them by submitting),
    // lineage tables, and supplement identity/location metadata only.
    const coursePayload = JSON.parse(new TextDecoder().decode(entries.get(`courses/${courseId}.json`)!)) as {
      row: { content: { practice?: { cards?: Array<{ answer: string }> } } };
      objectives: unknown[];
      sources: unknown[];
      supplementReferences: Array<Record<string, unknown>>;
    };
    expect(coursePayload.objectives.length).toBeGreaterThan(0);
    expect(coursePayload.sources.length).toBeGreaterThan(0);
    const storedAnswers = (coursePayload.row.content.practice?.cards ?? []).map(card => card.answer);
    expect(storedAnswers).toContain(canonicalAnswer);
    expect(coursePayload.supplementReferences).toHaveLength(3);
    for (const reference of coursePayload.supplementReferences)
      expect(Object.keys(reference).sort()).toEqual(['contentHash', 'locator', 'origin', 'outcome', 'position', 'retrievedAt', 'url']);
    // Practice payload: the typed rows with the attempted text.
    const practicePayload = JSON.parse(new TextDecoder().decode(entries.get('practice/practice-evidence.json')!)) as { rows: Array<{ attempted: string; evidence_kind: string }> };
    expect(practicePayload.rows.map(row => row.attempted).sort()).toEqual(['a standing double', 'arrange first']);
    expect(practicePayload.rows.map(row => row.evidence_kind).sort()).toEqual(['assisted', 'unaided']);
    // Why payload: the settled explanations with their text.
    const whyPayload = JSON.parse(new TextDecoder().decode(entries.get('why/why-explanations.json')!)) as { rows: Array<{ explanation: string | null; status: string; depth: number }> };
    expect(whyPayload.rows.filter(row => row.status === 'ready').map(row => row.depth).sort()).toEqual([1, 2]);
    expect(whyPayload.rows.every(row => typeof row.explanation === 'string' && row.explanation.length > 0)).toBe(true);
    // Supplement passages never enter the artifact: the conflict fixture's
    // fetched passage ('not the case') exists only in the excluded class.
    const artifactText = new TextDecoder().decode(gunzipSync(Buffer.from(await (await downloadExport(owner, receipt.rootId, new AbortController().signal)).arrayBuffer())));
    expect(artifactText).not.toContain('not the case');
  });
});
