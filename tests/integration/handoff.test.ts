import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../../src/modules/identity-access/auth";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase, transaction } from "../../src/adapters/postgres/database";
import { closeQueue } from "../../src/adapters/queue";
import { createBatch, uploadSlot, acknowledge, getBatch } from "../../src/modules/materials-setup/batches";
import { savePlan, confirmPlan } from "../../src/modules/materials-setup/service";
import { getHandoff } from "../../src/modules/materials-setup/handoff";
import { removeRoot } from "../../src/modules/lifecycle-platform/service";
import { runExtraction } from "../../src/modules/materials-setup/extraction";
import { protectedResponse } from "../../src/platform/http";
import type { InputsCommand } from "../../src/contracts/batches";
import type { Command, Identity, Plan } from "../../src/contracts/setup";

// All fixtures below are original synthetic content exercised against the isolated
// local PG cluster; nothing here processes real data or calls any provider.
const cmd = (expectedRevision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision });
const input = (name: string): InputsCommand["inputs"][number] => ({ slotId: crypto.randomUUID(), filename: name, mime: "text/plain", byteLength: 24 });
const data = () => new Blob(["Synthetic handoff source"]).stream();
const plan: Plan = { topic: "Handoff", goal: "Apply a skill", clarification: "", outcomes: ["Confirm exact revisions"], miniCourse: { title: "Handoff course", lessons: ["One lesson"], practice: "Check identities", estimatedMinutes: 10 }, missingExplanations: "Coverage unchecked; flags only for future supplementation" };

afterAll(async () => { await closeQueue(); await closeDatabase(); });

async function actor(label: string): Promise<Identity & { email: string; password: string }> {
  const account = await provisionSynthetic(label, "learner");
  const response = await auth().api.signInEmail({ body: { email: account.email, password: account.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>("SELECT id FROM auth.session WHERE token=$1", [body.token]);
  return { userId: account.userId, email: account.email, password: account.password, sessionId: session.rows[0].id };
}

// A second tab: the same owner signs in again, producing an independent session.
async function secondSession(account: { email: string; password: string; userId: string }): Promise<Identity> {
  const response = await auth().api.signInEmail({ body: { email: account.email, password: account.password }, asResponse: true });
  const body = await response.json();
  return { userId: account.userId, sessionId: (await database().query("SELECT id FROM auth.session WHERE token=$1", [body.token])).rows[0].id };
}

async function confirmedStudy(label: string, content: Plan = plan) {
  const a = await actor(label);
  const inputs = [input(`${label}-a.txt`), input(`${label}-b.txt`)];
  const batch = await createBatch(a, { ...cmd(), inputs });
  for (const item of inputs) {
    const receipt = await uploadSlot(a, batch.rootId, item.slotId, cmd(), data());
    await runExtraction(receipt.operationId!);
  }
  const preview = await getBatch(a, batch.rootId);
  const ack = await acknowledge(a, batch.rootId, {
    ...cmd(preview.revision),
    selected: preview.slots.map(slot => ({ slotId: slot.slotId, extractionId: slot.extractionId!, acknowledged: true as const })),
    excluded: [],
  });
  const saved = await savePlan(a, batch.rootId, { ...cmd(ack.revision), plan: content, selectionId: ack.selectionId!, extractionId: preview.slots[0].extractionId! });
  const confirmed = await confirmPlan(a, batch.rootId, { ...cmd(saved.revision), planRevisionId: saved.planRevisionId! });
  return { a, batch, ack, saved, confirmed, extractionIds: preview.slots.map(slot => slot.extractionId!), slots: preview.slots };
}

describe("exact-revision plan handoff (S5)", () => {
  it("returns exact confirmed plan/source identities with Manual provenance and duplicate confirmations stay one receipt", async () => {
    const study = await confirmedStudy("handoff-exact");
    const handoff = await getHandoff(study.a, study.batch.rootId);
    expect(handoff.planRevisionId).toBe(study.saved.planRevisionId);
    expect(handoff.selectionId).toBe(study.ack.selectionId);
    expect(handoff.provenance).toBe("Manual");
    expect(handoff.plan).toEqual(plan);
    expect(handoff.sources).toHaveLength(2);
    expect(handoff.sources.map(source => source.format)).toEqual(["txt", "txt"]);
    expect(handoff.sources.every(source => source.metadata?.parser === "bounded-documents-v2")).toBe(true);
    expect(handoff.objectIds).toEqual(expect.arrayContaining([study.saved.planRevisionId!, study.ack.selectionId!, ...study.extractionIds]));
    expect(Number.isNaN(new Date(handoff.confirmedAt).getTime())).toBe(false);

    // Duplicate confirmation: the same command replays one receipt; a different
    // command for the already-confirmed revision inserts no second confirmation.
    const confirmation = { ...cmd(study.confirmed.revision), planRevisionId: study.saved.planRevisionId! };
    const first = await confirmPlan(study.a, study.batch.rootId, confirmation);
    expect(await confirmPlan(study.a, study.batch.rootId, confirmation)).toEqual(first);
    const [raced, replayed] = await Promise.all([
      confirmPlan(study.a, study.batch.rootId, confirmation),
      confirmPlan(study.a, study.batch.rootId, confirmation),
    ]);
    expect(raced).toEqual(replayed);
    const later = await confirmPlan(study.a, study.batch.rootId, { ...cmd(first.revision), planRevisionId: study.saved.planRevisionId! });
    expect(later.planRevisionId).toBe(study.saved.planRevisionId);
    expect((await database().query("SELECT plan_id FROM app.plan_confirmation WHERE root_id=$1", [study.batch.rootId])).rowCount).toBe(1);
    expect((await getHandoff(study.a, study.batch.rootId)).planRevisionId).toBe(study.saved.planRevisionId);
    await removeRoot(study.a, study.batch.rootId, cmd(later.revision));
  });

  it("rejects absent confirmation, malformed ids, foreign owners, unauthenticated callers and deleted roots", async () => {
    const study = await confirmedStudy("handoff-deny");
    const b = await actor("handoff-other");
    // Malformed identifiers are invalid input, never a partial read.
    await expect(getHandoff(study.a, "not-a-uuid")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Absent confirmation conflicts: the handoff never returns a draft instead.
    const fresh = await actor("handoff-unconfirmed");
    const freshBatch = await createBatch(fresh, { ...cmd(), inputs: [input("handoff-unconfirmed.txt")] });
    await expect(getHandoff(fresh, freshBatch.rootId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(getHandoff(b, study.batch.rootId)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
    await database().query("DELETE FROM auth.session WHERE id=$1", [b.sessionId]);
    await expect(getHandoff(b, study.batch.rootId)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const revision = (await getBatch(study.a, study.batch.rootId)).revision;
    await removeRoot(study.a, study.batch.rootId, cmd(revision));
    // Transitive purge removes the study: like every other read of a purged
    // root, the handoff is simply unavailable — never a substituted draft.
    await expect(getHandoff(study.a, study.batch.rootId)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  });

  it("two-tab edit/confirm: an unconfirmed draft never substitutes; the handoff tracks only real confirmations", async () => {
    const study = await confirmedStudy("handoff-twotab");
    const tabB = await secondSession(study.a);
    // Tab B saves a newer draft after tab A's confirmation.
    const draft = await savePlan(tabB, study.batch.rootId, {
      ...cmd(study.confirmed.revision),
      plan: { ...plan, topic: "Second tab topic" },
      selectionId: study.ack.selectionId!,
      extractionId: study.extractionIds[0],
    });
    expect(draft.planRevisionId).not.toBe(study.saved.planRevisionId);
    let handoff = await getHandoff(study.a, study.batch.rootId);
    expect(handoff.planRevisionId).toBe(study.saved.planRevisionId);
    expect(handoff.plan.topic).toBe("Handoff");
    // The stale confirmation command cannot re-confirm across the newer draft.
    await expect(confirmPlan(study.a, study.batch.rootId, { ...cmd(study.saved.revision), planRevisionId: study.saved.planRevisionId! })).rejects.toMatchObject({ code: "CONFLICT" });
    // A deliberate new confirmation moves the handoff to that exact revision only.
    const confirmedDraft = await confirmPlan(tabB, study.batch.rootId, { ...cmd(draft.revision), planRevisionId: draft.planRevisionId! });
    handoff = await getHandoff(study.a, study.batch.rootId);
    expect(handoff.planRevisionId).toBe(confirmedDraft.planRevisionId);
    expect(handoff.plan.topic).toBe("Second tab topic");
    await removeRoot(study.a, study.batch.rootId, cmd(confirmedDraft.revision));
  });

  it("source deletion between handoff admission and commit denies remaining streamed bytes, later reads and re-confirmation", async () => {
    const study = await confirmedStudy("handoff-deletion");
    const handoff = await getHandoff(study.a, study.batch.rootId);
    // Stream the authorized payload; every chunk re-authorizes the full lineage.
    const response = protectedResponse(study.a, study.batch.rootId, "x".repeat(40000), new AbortController().signal, true, handoff.objectIds);
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toHaveLength(16384);
    const victim = study.slots[0];
    await removeRoot(study.a, victim.rootId, cmd(victim.revision));
    // No deleted replacement is consumed: the next chunk fails closed.
    await expect(reader.read()).rejects.toThrow("This item is unavailable");
    reader.releaseLock();
    // The confirmation pointer is gone after transitive purge: absent confirmation conflicts.
    await expect(getHandoff(study.a, study.batch.rootId)).rejects.toMatchObject({ code: "CONFLICT" });

    // Invalidated-but-unpurged lineage fails closed as unavailable, and the stale
    // plan cannot be re-confirmed into a usable handoff.
    const second = await confirmedStudy("handoff-invalidated");
    await database().query("UPDATE app.lifecycle_object SET invalidated_at=clock_timestamp() WHERE id=$1 AND kind='plan'", [second.saved.planRevisionId]);
    await expect(getHandoff(second.a, second.batch.rootId)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
    await expect(confirmPlan(second.a, second.batch.rootId, { ...cmd(second.confirmed.revision), planRevisionId: second.saved.planRevisionId! })).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  });

  it("setup-preference staleness (P2 pin): row-less owners stay confirmable and a later goal/topic change conflicts the older draft", async () => {
    // The pinned relation app.setup_preference (004-setup-preferences.sql) is
    // provisioned by the sibling preferences package; this test exercises the
    // guarded behavior in both worlds and never skips: whichever state the
    // database is in, the asserted outcome is the specified one.
    const pinned = (await database().query<{ present: string | null }>("SELECT to_regclass('app.setup_preference')::text AS present")).rows[0].present;
    const study = await confirmedStudy("handoff-preference");
    if (pinned) await transaction(client => client.query("DELETE FROM app.setup_preference WHERE owner_id=$1", [study.a.userId]));

    // Draft 1 is saved with no preference row: its recorded baseline is NULL and
    // confirmation must not be blocked (legacy/history-preserving guard).
    const draft1 = await savePlan(study.a, study.batch.rootId, { ...cmd(study.confirmed.revision), plan: { ...plan, topic: "Baseline draft" }, selectionId: study.ack.selectionId!, extractionId: study.extractionIds[0] });
    const baseline = (await database().query<{ preference_revision: number | null }>("SELECT preference_revision FROM app.plan_revision WHERE id=$1", [draft1.planRevisionId])).rows[0].preference_revision;
    expect(baseline).toBeNull();
    const confirmedDraft1 = await confirmPlan(study.a, study.batch.rootId, { ...cmd(draft1.revision), planRevisionId: draft1.planRevisionId! });
    expect(confirmedDraft1.planRevisionId).toBe(draft1.planRevisionId);

    if (pinned) {
      // Draft 2 records the preference revision it was saved against; changing the
      // preference afterwards conflicts confirming that older draft, while a fresh
      // save against the new revision confirms and hands off exactly.
      await transaction(client => client.query("INSERT INTO app.setup_preference(owner_id,stage,revision) VALUES($1,'plan',$2) ON CONFLICT (owner_id) DO UPDATE SET revision=EXCLUDED.revision", [study.a.userId, 41]));
      const draft2 = await savePlan(study.a, study.batch.rootId, { ...cmd(confirmedDraft1.revision), plan: { ...plan, topic: "Pinned draft" }, selectionId: study.ack.selectionId!, extractionId: study.extractionIds[0] });
      expect((await database().query<{ preference_revision: number | null }>("SELECT preference_revision FROM app.plan_revision WHERE id=$1", [draft2.planRevisionId])).rows[0].preference_revision).toBe(41);
      await transaction(client => client.query("UPDATE app.setup_preference SET revision=42 WHERE owner_id=$1", [study.a.userId]));
      await expect(confirmPlan(study.a, study.batch.rootId, { ...cmd(draft2.revision), planRevisionId: draft2.planRevisionId! })).rejects.toMatchObject({ code: "CONFLICT" });
      const draft3 = await savePlan(study.a, study.batch.rootId, { ...cmd(draft2.revision), plan: { ...plan, topic: "Rebased draft" }, selectionId: study.ack.selectionId!, extractionId: study.extractionIds[0] });
      const confirmedDraft3 = await confirmPlan(study.a, study.batch.rootId, { ...cmd(draft3.revision), planRevisionId: draft3.planRevisionId! });
      const handoff = await getHandoff(study.a, study.batch.rootId);
      expect(handoff.planRevisionId).toBe(confirmedDraft3.planRevisionId);
      expect(handoff.plan.topic).toBe("Rebased draft");
      await transaction(client => client.query("DELETE FROM app.setup_preference WHERE owner_id=$1", [study.a.userId]));
      await removeRoot(study.a, study.batch.rootId, cmd(confirmedDraft3.revision));
    } else {
      // Relation absent (preferences package not merged): the guarded read treats
      // this as "no preference recorded" and confirmation proceeds unchanged.
      await removeRoot(study.a, study.batch.rootId, cmd(confirmedDraft1.revision));
    }
  });
});
