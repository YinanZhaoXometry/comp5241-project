import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request, expect } from "@playwright/test";
import { provisionSynthetic } from "../src/modules/identity-access/provision";
import { closeDatabase } from "../src/adapters/postgres/database";
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
  const saved = await client.post(`${path}/plan`, { headers: { Origin: origin }, data: { ...command(preview.revision), extractionId: preview.extractionId, plan } });
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
  for (const secret of [text, owner.email, owner.password, other.email, other.password]) assert.ok(!output.join("").includes(secret), "Private data reached process output");
  console.log("Restart smoke passed: real web+worker stopped/restarted; exact plan/session persisted, B denied, root removed; process output content-free.");
} finally { await stop(); await client.dispose(); await denied.dispose(); await closeDatabase(); }