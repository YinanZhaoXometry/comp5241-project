import { afterAll, expect, it } from "vitest";
import { auth } from "../../src/modules/identity-access/auth";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { closeQueue } from "../../src/adapters/queue";
import { createBatch, addInputs, uploadSlot, acknowledge, getBatch, controlSlot } from "../../src/modules/materials-setup/batches";
import { savePlan, confirmPlan, upload, getStudy } from "../../src/modules/materials-setup/service";
import { runExtraction } from "../../src/modules/materials-setup/extraction";
import { removeRoot, reconcileCopies } from "../../src/modules/lifecycle-platform/service";
import { readdir } from "node:fs/promises";
import { config } from "../../src/platform/config";
import { getPreview, getOriginal } from "../../src/modules/materials-setup/queries";
import { protectedResponse } from "../../src/platform/http";
import type { Identity, Plan } from "../../src/contracts/setup";

const cmd = (expectedRevision = 0) => ({ schemaVersion: 1 as const, commandKey: crypto.randomUUID(), expectedRevision });
const input = (name = "source.txt") => ({ slotId: crypto.randomUUID(), filename: name, mime: "text/plain", byteLength: 16 });
const data = () => new Blob(["Synthetic source"]).stream();
const plan: Plan = { topic: "Tests", goal: "Apply a skill", clarification: "", outcomes: ["Test sources"], miniCourse: { title: "Tests", lessons: ["One lesson"], practice: "Inspect sources", estimatedMinutes: 10 }, missingExplanations: "Unchecked" };
async function actor(): Promise<Identity> {
  const account = await provisionSynthetic("batch", "learner");
  const response = await auth().api.signInEmail({ body: { email: account.email, password: account.password }, asResponse: true });
  const body = await response.json();
  return { userId: account.userId, sessionId: (await database().query('SELECT id FROM auth.session WHERE token=$1', [body.token])).rows[0].id };
}
afterAll(async () => { await closeQueue(); await closeDatabase(); });

it("atomically admits ten ordered slots and rejects racing eleventh inputs without jobs or roots", async () => {
  const a = await actor(); const slots = Array.from({ length: 9 }, (_, i) => input(`${i}.txt`));
  const batch = await createBatch(a, { ...cmd(), inputs: slots });
  const result = await Promise.allSettled([addInputs(a, batch.rootId, { ...cmd(), inputs: [input("tenth.txt")] }), addInputs(a, batch.rootId, { ...cmd(), inputs: [input("eleventh.txt")] })]);
  expect(result.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect((await getBatch(a, batch.rootId)).slots).toHaveLength(10);
  await expect(addInputs(a, batch.rootId, { ...cmd(1), inputs: [input()] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect((await database().query("SELECT count(*)::int AS n FROM app.lifecycle_root WHERE owner_id=$1", [a.userId])).rows[0].n).toBe(11);
  await removeRoot(a, batch.rootId, cmd(1));
});

it("accounts for mixed slots, rejects forged/stale selections, and freezes exact acknowledged sources", async () => {
  const a = await actor(); const one = input("one.txt"); const pending = input("pending.txt");
  const batch = await createBatch(a, { ...cmd(), inputs: [one, pending] });
  const uploaded = await uploadSlot(a, batch.rootId, one.slotId, cmd(), data());
  await runExtraction(uploaded.operationId!);
  const preview = await getBatch(a, batch.rootId);
  const selected = [{ slotId: one.slotId, extractionId: preview.slots[0].extractionId!, acknowledged: true as const }];
  await expect(acknowledge(a, batch.rootId, { ...cmd(preview.revision), selected, excluded: [] })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(acknowledge(a, batch.rootId, { ...cmd(0), selected, excluded: [{ slotId: pending.slotId, state: "awaiting-upload" }] })).rejects.toMatchObject({ code: "CONFLICT" });
  const ack = await acknowledge(a, batch.rootId, { ...cmd(preview.revision), selected, excluded: [{ slotId: pending.slotId, state: "awaiting-upload" }] });
  const saved = await savePlan(a, batch.rootId, { ...cmd(ack.revision), plan, selectionId: ack.selectionId!, extractionId: selected[0].extractionId });
  await confirmPlan(a, batch.rootId, { ...cmd(saved.revision), planRevisionId: saved.planRevisionId! });
  const current = await getBatch(a, batch.rootId);
  expect(current.confirmed?.selectionId).toBe(ack.selectionId);
  expect(current.selection?.excluded).toEqual([{ slotId: pending.slotId, state: "awaiting-upload" }]);
  const other = await actor();
  await expect(getBatch(other, batch.rootId)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  await database().query("DELETE FROM auth.session WHERE id=$1", [a.sessionId]);
  await expect(getBatch(a, batch.rootId)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});

it("deleting A transitively denies A+B plans and purges copies without deleting B", async () => {
  const a = await actor(); const inputs = [input("A.txt"), input("B.txt")];
  const batch = await createBatch(a, { ...cmd(), inputs });
  for (const item of inputs) { const receipt = await uploadSlot(a, batch.rootId, item.slotId, cmd(), data()); await runExtraction(receipt.operationId!); }
  const preview = await getBatch(a, batch.rootId);
  const ack = await acknowledge(a, batch.rootId, { ...cmd(preview.revision), selected: preview.slots.map(s => ({ slotId: s.slotId, extractionId: s.extractionId!, acknowledged: true as const })), excluded: [] });
  const saved = await savePlan(a, batch.rootId, { ...cmd(ack.revision), plan, selectionId: ack.selectionId!, extractionId: preview.slots[0].extractionId! });
  const keys = (await database().query("SELECT storage_key FROM app.lifecycle_object WHERE root_id=$1 AND storage_key IS NOT NULL", [preview.slots[0].rootId])).rows.map(x => x.storage_key);
  await removeRoot(a, preview.slots[0].rootId, cmd(1));
  await expect(confirmPlan(a, batch.rootId, { ...cmd(saved.revision), planRevisionId: saved.planRevisionId! })).rejects.toThrow();
  await reconcileCopies();
  const current = await getBatch(a, batch.rootId);
  expect(current.draft).toBeNull(); expect(current.slots[1].extractionId).toBe(preview.slots[1].extractionId);
  expect(keys.some(key => (current.slots[1].rootId === key))).toBe(false);
  const copies = await readdir(config().storagePath); expect(keys.some(key => copies.includes(key))).toBe(false);
  expect((await database().query("SELECT 1 FROM app.plan_revision WHERE id=$1", [saved.planRevisionId])).rowCount).toBe(0);
});

it("cancel/retry fences old attempts, reuses saved originals, and keeps copy inventory singular", async () => {
  const a = await actor(); const slot = input(); const batch = await createBatch(a, { ...cmd(), inputs: [slot] });
  const uploaded = await uploadSlot(a, batch.rootId, slot.slotId, cmd(), data());
  let current = await getBatch(a, batch.rootId);
  await controlSlot(a, batch.rootId, slot.slotId, { ...cmd(current.revision), action: "cancel" });
  await runExtraction(uploaded.operationId!);
  expect((await getBatch(a, batch.rootId)).slots[0].state).toBe("canceled");
  current = await getBatch(a, batch.rootId);
  await controlSlot(a, batch.rootId, slot.slotId, { ...cmd(current.revision), action: "retry" });
  await runExtraction(uploaded.operationId!);
  current = await getBatch(a, batch.rootId);
  expect(current.slots[0].state).toBe("preview");
  expect((await database().query("SELECT kind,count(*)::int AS n FROM app.lifecycle_object WHERE root_id=$1 GROUP BY kind ORDER BY kind", [current.slots[0].rootId])).rows).toEqual([{ kind: "extraction", n: 1 }, { kind: "original", n: 1 }]);
});

it("replays an uploaded slot once and exposes honest pending at 120 seconds with its saved original", async () => {
  const a = await actor(); const slot = input(); const batch = await createBatch(a, { ...cmd(), inputs: [slot] });
  const uploadCommand = cmd();
  const first = await uploadSlot(a, batch.rootId, slot.slotId, uploadCommand, data());
  expect(await uploadSlot(a, batch.rootId, slot.slotId, uploadCommand, data())).toEqual(first);
  await database().query("UPDATE app.operation SET created_at=clock_timestamp()-interval '120 seconds' WHERE id=$1", [first.operationId]);
  const pending = (await getBatch(a, batch.rootId)).slots[0];
  expect(pending).toMatchObject({ pending: true, state: "queued", operationId: first.operationId, extractionId: null });
  expect((await getOriginal(a, pending.rootId)).bytes.toString()).toBe("Synthetic source");
  expect((await database().query("SELECT kind,count(*)::int AS n FROM app.lifecycle_object WHERE root_id=$1 GROUP BY kind", [pending.rootId])).rows).toEqual([{ kind: "original", n: 1 }]);
  await runExtraction(first.operationId!); await runExtraction(first.operationId!);
  expect((await getBatch(a, batch.rootId)).slots[0]).toMatchObject({ pending: false, state: "preview" });
  expect((await database().query("SELECT 1 FROM app.extraction_revision WHERE root_id=$1", [pending.rootId])).rowCount).toBe(1);
});

it("rejects foreign extraction forgery and cancels a claimed attempt without late copies", async () => {
  const a = await actor(); const source = input(); const batch = await createBatch(a, { ...cmd(), inputs: [source] });
  const uploaded = await uploadSlot(a, batch.rootId, source.slotId, cmd(), data());
  let reached!: () => void; let release!: () => void;
  const claimed = new Promise<void>(resolve => { reached = resolve; }); const resume = new Promise<void>(resolve => { release = resolve; });
  const running = runExtraction(uploaded.operationId!, async text => { reached(); await resume; return text; });
  await claimed;
  let current = await getBatch(a, batch.rootId);
  await controlSlot(a, batch.rootId, source.slotId, { ...cmd(current.revision), action: "cancel" });
  release(); await running;
  current = await getBatch(a, batch.rootId);
  expect(current.slots[0].state).toBe("canceled");
  expect((await database().query("SELECT kind FROM app.lifecycle_object WHERE root_id=$1", [current.slots[0].rootId])).rows).toEqual([{ kind: "original" }]);
  expect((await getOriginal(a, current.slots[0].rootId)).bytes.toString()).toBe("Synthetic source");
  await controlSlot(a, batch.rootId, source.slotId, { ...cmd(current.revision), action: "retry" });
  await runExtraction(uploaded.operationId!);
  current = await getBatch(a, batch.rootId);
  await expect(acknowledge(a, batch.rootId, { ...cmd(current.revision), selected: [{ slotId: source.slotId, extractionId: crypto.randomUUID(), acknowledged: true }], excluded: [] })).rejects.toMatchObject({ code: "CONFLICT" });
});

it("denies remaining streamed A+B plan bytes after deleting ancestor A while B remains previewable", async () => {
  const a = await actor(); const inputs = [input("stream-A.txt"), input("stream-B.txt")];
  const batch = await createBatch(a, { ...cmd(), inputs });
  for (const item of inputs) { const receipt = await uploadSlot(a, batch.rootId, item.slotId, cmd(), data()); await runExtraction(receipt.operationId!); }
  const preview = await getBatch(a, batch.rootId);
  const ack = await acknowledge(a, batch.rootId, { ...cmd(preview.revision), selected: preview.slots.map(s => ({ slotId: s.slotId, extractionId: s.extractionId!, acknowledged: true })), excluded: [] });
  const saved = await savePlan(a, batch.rootId, { ...cmd(ack.revision), plan, selectionId: ack.selectionId!, extractionId: preview.slots[0].extractionId! });
  const response = protectedResponse(a, batch.rootId, "x".repeat(40000), new AbortController().signal, true, [saved.planRevisionId!]);
  const reader = response.body!.getReader(); expect((await reader.read()).value).toHaveLength(16384);
  await removeRoot(a, preview.slots[0].rootId, cmd(preview.slots[0].revision));
  await expect(reader.read()).rejects.toThrow("This item is unavailable"); reader.releaseLock();
  await expect(getPreview(a, preview.slots[0].rootId, preview.slots[0].extractionId!)).rejects.toMatchObject({ code: "FORBIDDEN_OR_NOT_FOUND" });
  expect((await getPreview(a, preview.slots[1].rootId, preview.slots[1].extractionId!)).text).toBe("Synthetic source");
});

it("races deletion and exact confirmation on separate clients with no surviving derivative", async () => {
  const a = await actor(); const source = input(); const batch = await createBatch(a, { ...cmd(), inputs: [source] });
  const upload = await uploadSlot(a, batch.rootId, source.slotId, cmd(), data()); await runExtraction(upload.operationId!);
  const preview = await getBatch(a, batch.rootId);
  const ack = await acknowledge(a, batch.rootId, { ...cmd(preview.revision), selected: [{ slotId: source.slotId, extractionId: preview.slots[0].extractionId!, acknowledged: true }], excluded: [] });
  const saved = await savePlan(a, batch.rootId, { ...cmd(ack.revision), plan, selectionId: ack.selectionId!, extractionId: preview.slots[0].extractionId! });
  await Promise.allSettled([confirmPlan(a, batch.rootId, { ...cmd(saved.revision), planRevisionId: saved.planRevisionId! }), removeRoot(a, preview.slots[0].rootId, cmd(preview.slots[0].revision))]);
  await reconcileCopies();
  expect((await getBatch(a, batch.rootId)).confirmed).toBeNull();
  expect((await database().query("SELECT 1 FROM app.plan_revision WHERE id=$1", [saved.planRevisionId])).rowCount).toBe(0);
});

it("replaces removed slots at ten-input capacity and excludes removed history from acknowledgment", async () => {
  const a = await actor(); const inputs = Array.from({ length: 10 }, (_, i) => input(`replace-${i}.txt`));
  const batch = await createBatch(a, { ...cmd(), inputs });
  const original = (await getBatch(a, batch.rootId)).slots[0]; await removeRoot(a, original.rootId, cmd());
  let current = await getBatch(a, batch.rootId); const replacement = input("replacement.txt");
  await addInputs(a, batch.rootId, { ...cmd(current.revision), inputs: [replacement] });
  const upload = await uploadSlot(a, batch.rootId, replacement.slotId, cmd(), data()); await runExtraction(upload.operationId!);
  current = await getBatch(a, batch.rootId); const usable = current.slots.find(s => s.slotId === replacement.slotId)!;
  const receipt = await acknowledge(a, batch.rootId, { ...cmd(current.revision), selected: [{ slotId: usable.slotId, extractionId: usable.extractionId!, acknowledged: true }], excluded: current.slots.filter(s => s.state === "awaiting-upload").map(s => ({ slotId: s.slotId, state: "awaiting-upload" })) });
  expect(receipt.selectionId).toBeTruthy(); expect(current.slots.filter(s => s.state !== "removed")).toHaveLength(10);
});

it("exposes a real aggregate operation only for legacy singleton batches, never for slot batches", async () => {
  const a = await actor(); const one = input("aggregate-a.txt");
  const batch = await createBatch(a, { ...cmd(), inputs: [one, input("aggregate-b.txt")] });
  const first = await uploadSlot(a, batch.rootId, one.slotId, cmd(), data());
  const multi = await getStudy(a, batch.rootId);
  expect(multi.operation).toBeNull();
  expect(multi.slots.find(slot => slot.slotId === one.slotId)).toMatchObject({ state: "queued", operationId: first.operationId });
  const legacy = await upload(a, { ...cmd(), expectedRevision: 0 }, "aggregate-single.txt", data());
  const single = await getStudy(a, legacy.rootId);
  expect(single.operation).toMatchObject({ id: legacy.operationId, state: "queued" });
  await removeRoot(a, legacy.rootId, cmd());
});

it("applies the owner-wide pending-extraction cap to batch slot uploads without orphan copies", async () => {
  const a = await actor();
  const full = await createBatch(a, { ...cmd(), inputs: Array.from({ length: 10 }, (_, i) => input(`cap-${i}.txt`)) });
  for (const slot of (await getBatch(a, full.rootId)).slots) await uploadSlot(a, full.rootId, slot.slotId, cmd(), data());
  const overflowBatch = await createBatch(a, { ...cmd(), inputs: [input("overflow.txt")] });
  const overflow = (await getBatch(a, overflowBatch.rootId)).slots[0];
  await expect(uploadSlot(a, overflowBatch.rootId, overflow.slotId, cmd(), data())).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect((await database().query("SELECT 1 FROM app.lifecycle_object WHERE root_id=$1", [overflow.rootId])).rowCount).toBe(0);
  expect((await database().query("SELECT 1 FROM app.operation WHERE root_id=$1", [overflow.rootId])).rowCount).toBe(0);
  expect((await database().query("SELECT 1 FROM app.lifecycle_staging WHERE owner_id=$1", [a.userId])).rowCount).toBe(0);
});

it("delete receipts carry the final affected batch revision, including per-slot touches", async () => {
  const a = await actor(); const inputs = [input("receipt-a.txt"), input("receipt-b.txt"), input("receipt-c.txt")];
  const batch = await createBatch(a, { ...cmd(), inputs });
  for (const slot of inputs) { const receipt = await uploadSlot(a, batch.rootId, slot.slotId, cmd(), data()); await runExtraction(receipt.operationId!); }
  const before = await getBatch(a, batch.rootId);
  const slotDelete = await removeRoot(a, before.slots[0].rootId, cmd(before.slots[0].revision));
  const afterSlot = await getBatch(a, batch.rootId);
  expect(slotDelete.revision).toBe(afterSlot.revision);
  const batchDelete = await removeRoot(a, batch.rootId, cmd(afterSlot.revision));
  const final = await database().query<{ revision: number }>("SELECT revision FROM app.study_batch WHERE id=$1", [batch.rootId]);
  expect(batchDelete.revision).toBe(final.rows[0].revision);
});