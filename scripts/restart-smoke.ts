import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request, expect } from "@playwright/test";
import { provisionSynthetic } from "../src/modules/identity-access/provision";
import { database, closeDatabase } from "../src/adapters/postgres/database";
import { pdf } from "../tests/fixtures/documents";
import type { Receipt, Plan } from "../src/contracts/setup";

const origin = "http://127.0.0.1:3000";
const text = "Synthetic restart-only source: deterministic tests.";
const owner = await provisionSynthetic("restart-owner", "learner");
const other = await provisionSynthetic("restart-denied", "learner");
const client = await request.newContext({ baseURL: origin });
const denied = await request.newContext({ baseURL: origin });
const output: string[] = [];
let processes: ChildProcess[] = [];
function launch(args: string[], marker: RegExp) {
  const child = spawn(process.execPath, args, { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  processes.push(child);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("Local process readiness timeout")); }, 30000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Local process exited before readiness")); });
    child.stdout!.on("data", (chunk: Buffer) => {
      const value = chunk.toString(); output.push(value);
      if (marker.test(value)) { clearTimeout(timer); resolve(); }
    });
    child.stderr!.on("data", (chunk: Buffer) => { output.push(chunk.toString()); });
  });
}
async function start() {
  await launch(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1"], /Ready in/u);
  await launch(["node_modules/tsx/dist/cli.mjs", "src/worker/main.ts"], /worker-ready/u);
}
async function stop() {
  const running = processes; processes = [];
  await Promise.all(running.map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null) { resolve(); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 10000);
    child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
  })));
}
function command(expectedRevision = 0) { return { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision }; }
const plan: Plan = { topic: "Restart persistence", goal: "Apply a skill", clarification: "", outcomes: ["Retain a confirmed plan"], miniCourse: { title: "Persistent tests", lessons: ["Restart safely"], practice: "Check exact persisted data", estimatedMinutes: 10 }, missingExplanations: "Coverage is unchecked; no AI generation." };
try {
  await start();
  for (const [context, account] of [[client, owner], [denied, other]] as const) {
    assert.equal((await context.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: account.email, password: account.password } })).status(), 200);
  }
  const uploaded = await client.post("/api/v1/studies", { headers: { Origin: origin, "Content-Type": "text/plain", "x-filename": "restart.txt", "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": crypto.randomUUID() }, data: text });
  assert.equal(uploaded.status(), 202);
  const receipt = await uploaded.json() as Receipt;
  const path = `/api/v1/studies/${receipt.rootId}`;
  await expect.poll(async () => (await (await client.get(path)).json()).operation.state, { timeout: 20000 }).toBe("preview");
  const preview = await (await client.get(path)).json();
  const acknowledgment = await client.post(`/api/v1/batches/${receipt.rootId}/selection`, { headers: { Origin: origin }, data: { ...command(preview.revision), selected: [{ slotId: preview.slots[0].slotId, extractionId: preview.extractionId, acknowledged: true }], excluded: [] } });
  assert.equal(acknowledgment.status(), 200);
  const selection = await acknowledgment.json() as Receipt;
  const saved = await client.post(`${path}/plan`, { headers: { Origin: origin }, data: { ...command(selection.revision), selectionId: selection.selectionId, extractionId: preview.extractionId, plan } });
  assert.equal(saved.status(), 200);
  const draft = await saved.json() as Receipt;
  const confirmed = await client.post(`${path}/confirmation`, { headers: { Origin: origin }, data: { ...command(draft.revision), planRevisionId: draft.planRevisionId } });
  assert.equal(confirmed.status(), 200);
  const before = await (await client.get(`${path}/plan`)).json();
  await stop(); await start();
  assert.deepEqual(await (await client.get(`${path}/plan`)).json(), before);
  assert.equal((await denied.get(`${path}/plan`)).status(), 404);
  const reopened = await (await client.get(path)).json();
  assert.equal((await client.post(`${path}/removal`, { headers: { Origin: origin }, data: command(reopened.revision) })).status(), 200);
  assert.equal((await client.get(path)).status(), 404);
  // Persist a binary original while no worker is running, then recover its
  // unchanged v1 job on an actual web/worker restart. No fake in-memory queue.
  await stop();
  await launch(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1"], /Ready in/u);
  const slotId = crypto.randomUUID(); const bytes = pdf();
  const batchResponse = await client.post("/api/v1/batches", { headers: { Origin: origin }, data: { ...command(), inputs: [{ slotId, filename: "restart.pdf", mime: "application/pdf", byteLength: bytes.length }] } });
  assert.equal(batchResponse.status(), 201); const batch = await batchResponse.json() as Receipt;
  const uploadKey = crypto.randomUUID();
  const uploadOptions = { headers: { Origin: origin, "Content-Type": "application/octet-stream", "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": uploadKey }, data: bytes };
  const binaryResponse = await client.post(`/api/v1/batches/${batch.rootId}/slots/${slotId}`, uploadOptions);
  assert.equal(binaryResponse.status(), 202); const binary = await binaryResponse.json() as Receipt;
  const pending = await (await client.get(`/api/v1/studies/${batch.rootId}`)).json();
  assert.equal(pending.slots[0].state, "queued");
  const copies = (await database().query("SELECT id,storage_key FROM app.lifecycle_object WHERE root_id=$1 AND kind='original'", [pending.slots[0].rootId])).rows;
  await stop(); await start();
  await expect.poll(async () => (await (await client.get(`/api/v1/studies/${batch.rootId}`)).json()).slots[0].state, { timeout: 120000 }).toBe("preview");
  assert.deepEqual(await (await client.post(`/api/v1/batches/${batch.rootId}/slots/${slotId}`, uploadOptions)).json(), binary);
  assert.deepEqual((await database().query("SELECT id,storage_key FROM app.lifecycle_object WHERE root_id=$1 AND kind='original'", [pending.slots[0].rootId])).rows, copies);
  assert.equal((await database().query("SELECT 1 FROM app.extraction_revision WHERE root_id=$1", [pending.slots[0].rootId])).rowCount, 1);
  assert.deepEqual(await (await client.get(`/api/v1/studies/${pending.slots[0].rootId}/material`)).body(), bytes);
  const recovered = await (await client.get(`/api/v1/studies/${batch.rootId}`)).json();
  assert.equal((await client.post(`/api/v1/studies/${batch.rootId}/removal`, { headers: { Origin: origin }, data: command(recovered.revision) })).status(), 200);
  for (const secret of [text, owner.email, owner.password, other.email, other.password]) assert.ok(!output.join("").includes(secret), "Private data reached process output");
  console.log("Restart smoke passed: exact plan/session persisted, B denied, queued PDF recovered with the same original and one extraction, duplicate receipt replayed, roots removed; process output content-free.");
} finally { await stop(); await client.dispose(); await denied.dispose(); await closeDatabase(); }