import { afterAll, expect, it } from "vitest";
import { auth } from "../../src/modules/identity-access/auth";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { closeQueue } from "../../src/adapters/queue";
import { createBatch, uploadSlot, acknowledge, getBatch } from "../../src/modules/materials-setup/batches";
import { savePlan, confirmPlan } from "../../src/modules/materials-setup/service";
import { runExtraction } from "../../src/modules/materials-setup/extraction";
import { removeRoot, reconcileCopies } from "../../src/modules/lifecycle-platform/service";
import {
  getCheckState,
  getBundleState,
  takeCheck,
  skipCheck,
  submitItem,
  finishCheck,
  flagUnclear,
} from "../../src/modules/setup-diagnostic/service";
import { syntheticCatalog } from "../../src/modules/setup-diagnostic/bundle";
import { protectedResponse } from "../../src/platform/http";
import type { Command, Identity, Plan } from "../../src/contracts/setup";
import type { SubmitItem } from "../../src/contracts/diagnostic";

const cmd = (expectedRevision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision });
const data = () => new Blob(["Synthetic diagnostic source"]).stream();
const planWith = (outcomes: number, topic = "Synthetic diagnostic"): Plan => ({ topic, goal: "Apply a skill", clarification: "", outcomes: Array.from({ length: outcomes }, (_, index) => `Synthetic outcome ${index + 1}`), miniCourse: { title: "Check", lessons: ["One lesson"], practice: "Practice", estimatedMinutes: 20 }, missingExplanations: "Coverage not assessed." });
// Beyond-criteria probes: every declared answer text and rationale must be
// absent from every pre-submission payload (objects, JSON and streamed bytes).
// Beyond-criteria probes: every declared rationale must be absent from every
// pre-submission payload (objects, JSON and streamed bytes). The choices —
// including the correct option's text — must be visible to take the check;
// what may not leak is WHICH choice is correct (no answerId/correctChoiceId
// fields before submission, asserted below) and never the rationale.
const probes = syntheticCatalog.items.map(item => item.rationale);
const leaks = (payload: unknown) => { const text = JSON.stringify(payload); return probes.filter(probe => text.includes(probe)); };
type Account = Awaited<ReturnType<typeof provisionSynthetic>>;
async function login(account: Account): Promise<Identity> {
  const response = await auth().api.signInEmail({ body: { email: account.email, password: account.password }, asResponse: true });
  const body = await response.json();
  const session = (await database().query<{ id: string }>("SELECT id FROM auth.session WHERE token=$1", [body.token])).rows[0];
  return { userId: account.userId, sessionId: session.id };
}
async function actor(label: string) {
  const account = await provisionSynthetic(`diag-${label}`, "learner");
  return { account, ...(await login(account)) };
}
async function confirmedStudy(a: Identity, sources: number, outcomes: number) {
  const inputs = Array.from({ length: sources }, (_, index) => ({ slotId: crypto.randomUUID(), filename: `diag-${index}.txt`, mime: "text/plain", byteLength: 27 }));
  const batch = await createBatch(a, { ...cmd(), inputs });
  for (const input of inputs) { const receipt = await uploadSlot(a, batch.rootId, input.slotId, cmd(), data()); await runExtraction(receipt.operationId!); }
  const preview = await getBatch(a, batch.rootId);
  const ack = await acknowledge(a, batch.rootId, { ...cmd(preview.revision), selected: preview.slots.map(slot => ({ slotId: slot.slotId, extractionId: slot.extractionId!, acknowledged: true as const })), excluded: [] });
  const saved = await savePlan(a, batch.rootId, { ...cmd(ack.revision), plan: planWith(outcomes), selectionId: ack.selectionId!, extractionId: preview.slots[0].extractionId! });
  const confirmed = await confirmPlan(a, batch.rootId, { ...cmd(saved.revision), planRevisionId: saved.planRevisionId! });
  return { rootId: batch.rootId, revision: confirmed.revision, planId: confirmed.planRevisionId! };
}
// The protected streaming path is the actual API byte carrier; scan it too.
async function bodyOf(identity: Identity, rootId: string, value: unknown) {
  const response = protectedResponse(identity, rootId, value, new AbortController().signal);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); }
  return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}
afterAll(async () => { await closeQueue(); await closeDatabase(); });

it("withholds answers before submission, records typed evidence once, and never grants completion credit", async () => {
  const a = await actor("main");
  const study = await confirmedStudy(a, 2, 3);
  const before = await getCheckState(a, study.rootId);
  expect(before).toMatchObject({ status: "offered", synthetic: true, source: "manual-synthetic", bundleId: null, skipRecorded: false, finishRecorded: false });
  expect(leaks(before)).toEqual([]);
  expect(JSON.stringify(before)).not.toContain("rationale");
  expect(JSON.stringify(before)).not.toContain("answerId");
  expect(await bodyOf(a, study.rootId, before)).not.toContain(probes[0]);
  const takeCommand = cmd(study.revision);
  const take = await takeCheck(a, study.rootId, takeCommand);
  expect(take.bundleId).toBeTruthy();
  expect(leaks(take)).toEqual([]);
  expect(await takeCheck(a, study.rootId, takeCommand)).toEqual(take); // one bundle per replay
  await expect(takeCheck(a, study.rootId, cmd(study.revision))).rejects.toMatchObject({ code: "CONFLICT" });
  const state = await getCheckState(a, study.rootId);
  expect(state).toMatchObject({ status: "active", bundleId: take.bundleId, planId: study.planId });
  expect(state.items).toHaveLength(4);
  expect(state.items.every(item => item.evidence === null)).toBe(true);
  expect(state.items.map(item => item.objective)).toEqual(["Synthetic outcome 1", "Synthetic outcome 2", "Synthetic outcome 3", "Synthetic outcome 3"]);
  expect(state.items[0].prompt).toContain("diag-0.txt");
  expect(leaks(state)).toEqual([]);
  // Submit correct, then replay the same command, then a second key with the
  // same choice (no second record), then a contradicting attempt (CONFLICT).
  const submitCommand: SubmitItem = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 1, choiceId: "b", assistance: "unaided" };
  const submit = await submitItem(a, study.rootId, take.bundleId, submitCommand);
  expect(submit).toMatchObject({ position: 1, outcome: "correct", correctChoiceId: "b" });
  expect(submit.rationale).toBe(syntheticCatalog.items[0].rationale);
  expect(await submitItem(a, study.rootId, take.bundleId, submitCommand)).toEqual(submit);
  expect(await submitItem(a, study.rootId, take.bundleId, { ...submitCommand, commandKey: crypto.randomUUID() })).toEqual(submit);
  await expect(submitItem(a, study.rootId, take.bundleId, { ...submitCommand, commandKey: crypto.randomUUID(), choiceId: "a" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(submitItem(a, study.rootId, take.bundleId, { ...submitCommand, commandKey: crypto.randomUUID(), choiceId: "zz" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const wrong = await submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 2, choiceId: "a", assistance: "assisted" });
  expect(wrong).toMatchObject({ outcome: "incorrect" });
  expect(wrong.rationale).toBe(syntheticCatalog.items[1].rationale);
  const skipped = await submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 3, assistance: "unaided" });
  expect(skipped).toMatchObject({ outcome: "unknown", correctChoiceId: null, rationale: null }); // skipping keeps the answer withheld
  await expect(submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 5, choiceId: "b", assistance: "unaided" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const partial = await getCheckState(a, study.rootId);
  expect(partial).toMatchObject({ submittedCount: 2, unknownCount: 2 });
  // Unsubmitted item 4 still leaks nothing even after others were revealed.
  expect(leaks(partial.items.find(item => item.position === 4))).toEqual([]);
  expect(JSON.stringify(partial.items.find(item => item.position === 4))).not.toContain("rationale");
  expect(partial.items.find(item => item.position === 1)?.evidence).toMatchObject({ outcome: "correct", unclear: false, path: "item-submit" });
  const flag = await flagUnclear(a, study.rootId, take.bundleId, { ...cmd(study.revision), position: 1 });
  expect(flag).toMatchObject({ position: 1, unclear: true });
  await flagUnclear(a, study.rootId, take.bundleId, { ...cmd(study.revision), position: 1 }); // idempotent one-way flag
  await expect(flagUnclear(a, study.rootId, take.bundleId, { ...cmd(study.revision), position: 3 })).rejects.toMatchObject({ code: "CONFLICT" }); // skipped items cannot be flagged
  const finished = await finishCheck(a, study.rootId, take.bundleId, cmd(study.revision));
  expect(finished).toMatchObject({ path: "check-finish", submitted: 2, unknown: 2 });
  expect(await finishCheck(a, study.rootId, take.bundleId, cmd(study.revision))).toMatchObject({ submitted: 2, unknown: 2 });
  const done = await getCheckState(a, study.rootId);
  expect(done.status).toBe("finished");
  expect(done.finishRecorded).toBe(true);
  // Direct conversion attempt: the check cannot be retaken into a new award,
  // and recorded payloads carry no score/credit/completion semantics at all.
  await expect(takeCheck(a, study.rootId, cmd(study.revision))).rejects.toMatchObject({ code: "CONFLICT" });
  const serialized = JSON.stringify(done);
  for (const banned of ['"score"', '"credit"', '"completion"', '"grade"', '"passed"', '"awarded"']) expect(serialized).not.toContain(banned);
  expect((await database().query("SELECT count(*)::int AS n FROM app.diagnostic_evidence WHERE bundle_id=$1", [take.bundleId])).rows[0].n).toBe(3);
});

it("records skip as a distinct setup-finishing path, including when the check is unavailable", async () => {
  const a = await actor("skip");
  const small = await confirmedStudy(a, 1, 1);
  const unavailable = await getCheckState(a, small.rootId);
  expect(unavailable.status).toBe("unavailable");
  await expect(takeCheck(a, small.rootId, cmd(small.revision))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const skip = await skipCheck(a, small.rootId, cmd(small.revision));
  expect(skip).toMatchObject({ path: "check-skip", rootId: small.rootId });
  expect(await skipCheck(a, small.rootId, cmd(small.revision))).toEqual(skip);
  await skipCheck(a, small.rootId, cmd(small.revision)); // fresh key: no duplicate receipt
  expect((await database().query("SELECT count(*)::int AS n FROM app.command_receipt WHERE owner_id=$1 AND action='skip-check'", [a.userId])).rows[0].n).toBe(1);
  expect((await getCheckState(a, small.rootId)).skipRecorded).toBe(true);
  await expect(submitItem(a, small.rootId, crypto.randomUUID(), { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: small.revision, position: 1, choiceId: "b", assistance: "unaided" })).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  // On a supported plan, skip and take are distinct recorded paths.
  const full = await confirmedStudy(a, 2, 3);
  await skipCheck(a, full.rootId, cmd(full.revision));
  const taken = await takeCheck(a, full.rootId, cmd(full.revision));
  const offered = await getCheckState(a, full.rootId);
  expect(offered.skipRecorded).toBe(true);
  expect(offered).toMatchObject({ status: "active", bundleId: taken.bundleId });
});

it("keeps old evidence historical after re-confirmation, denies stale submissions, and pins a new bundle", async () => {
  const a = await actor("historical");
  const study = await confirmedStudy(a, 2, 3);
  const take = await takeCheck(a, study.rootId, cmd(study.revision));
  await submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 2, choiceId: "b", assistance: "assisted" });
  const preview = await getBatch(a, study.rootId);
  const saved = await savePlan(a, study.rootId, { ...cmd(preview.revision), plan: planWith(3, "Revised synthetic topic"), selectionId: preview.selection!.id, extractionId: preview.slots[0].extractionId! });
  const reconfirmed = await confirmPlan(a, study.rootId, { ...cmd(saved.revision), planRevisionId: saved.planRevisionId! });
  const state = await getCheckState(a, study.rootId);
  expect(state.historical).toBe(true);
  expect(state.bundleId).toBeNull();
  expect(state.status).toBe("offered");
  await expect(submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: reconfirmed.revision, position: 1, choiceId: "b", assistance: "unaided" })).rejects.toMatchObject({ code: "CONFLICT" });
  const history = await getBundleState(a, study.rootId, take.bundleId);
  expect(history.historical).toBe(true);
  expect(history.items.find(item => item.position === 2)?.evidence).toMatchObject({ outcome: "correct", assistance: "assisted" });
  const newTake = await takeCheck(a, study.rootId, cmd(reconfirmed.revision));
  const pinned = (await database().query<{ plan_id: string }>("SELECT plan_id FROM app.diagnostic_bundle WHERE id=$1", [newTake.bundleId])).rows[0];
  expect(pinned.plan_id).toBe((await database().query<{ confirmed_id: string | null }>("SELECT confirmed_id FROM app.study_batch WHERE id=$1", [study.rootId])).rows[0].confirmed_id);
  expect((await database().query("SELECT count(*)::int AS n FROM app.diagnostic_evidence WHERE bundle_id=$1", [take.bundleId])).rows[0].n).toBe(1); // old evidence intact
});

it("denies the check and its evidence when a selected source is deleted (transitive invalidation)", async () => {
  const a = await actor("fence");
  const study = await confirmedStudy(a, 2, 3);
  const take = await takeCheck(a, study.rootId, cmd(study.revision));
  await submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 1, choiceId: "b", assistance: "unaided" });
  const preview = await getBatch(a, study.rootId);
  await removeRoot(a, preview.slots[0].rootId, cmd(preview.slots[0].revision));
  // Deleting a selected source purges the dead plan lineage; its bundles and
  // evidence are cascade-removed (bundle.plan_id ON DELETE CASCADE), so the
  // state read honestly reports the cleared lineage and exposes nothing.
  const cleared = await getCheckState(a, study.rootId);
  expect(cleared).toMatchObject({ status: "no-confirmed-plan", bundleId: null, confirmedPlanId: null, items: [], submittedCount: 0 });
  await expect(getBundleState(a, study.rootId, take.bundleId)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  await expect(submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 2, assistance: "unaided" })).rejects.toThrow();
});

it("denies other owners and revoked sessions, and purges diagnostics transitively with the root", async () => {
  const a = await actor("authz");
  const other = await actor("other");
  const study = await confirmedStudy(a, 2, 3);
  const take = await takeCheck(a, study.rootId, cmd(study.revision));
  for (const attempt of [
    () => getCheckState(other, study.rootId),
    () => takeCheck(other, study.rootId, cmd(study.revision)),
    () => getBundleState(other, study.rootId, take.bundleId),
    () => submitItem(other, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 1, choiceId: "b", assistance: "unaided" }),
  ]) await expect(attempt()).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  await submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 1, choiceId: "b", assistance: "unaided" });
  await database().query("DELETE FROM auth.session WHERE id=$1", [a.sessionId]);
  for (const attempt of [
    () => getCheckState(a, study.rootId),
    () => submitItem(a, study.rootId, take.bundleId, { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, position: 2, assistance: "unaided" }),
    () => finishCheck(a, study.rootId, take.bundleId, cmd(study.revision)),
  ]) await expect(attempt()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  const fresh = await login(a.account);
  await removeRoot(fresh, study.rootId, cmd(study.revision));
  await expect(getCheckState(fresh, study.rootId)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  await reconcileCopies();
  for (const table of ["app.diagnostic_evidence", "app.diagnostic_item", "app.diagnostic_bundle"]) {
    expect((await database().query(`SELECT count(*)::int AS n FROM ${table} WHERE ${table === "app.diagnostic_bundle" ? "root_id" : "bundle_id"}=$1`, [study.rootId])).rows[0].n).toBe(0);
  }
  expect((await database().query("SELECT count(*)::int AS n FROM app.lifecycle_object WHERE root_id=$1 AND kind='diagnostic'", [study.rootId])).rows[0].n).toBe(0);
  const otherStudy = await confirmedStudy(other, 2, 3);
  expect((await getCheckState(other, otherStudy.rootId)).status).toBe("offered"); // unrelated owner unaffected
});
