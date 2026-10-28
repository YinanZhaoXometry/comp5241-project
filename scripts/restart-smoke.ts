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
// Web only: the course beat queues its generation job with NO worker running,
// so the restart genuinely recovers a persisted pending job.
async function startWeb() {
  await launch(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1"], /Ready in/u);
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
const coursePlan: Plan = { topic: "Restart course", goal: "Understand a topic", clarification: "", outcomes: ["Recall the restart source"], miniCourse: { title: "Restart course", lessons: ["One restart lesson"], practice: "Submit the recall item", estimatedMinutes: 10 }, missingExplanations: "Coverage is unchecked." };
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
  // Epic-2 S1 beat: confirm a fresh study, grant processing consent, then
  // queue the course generation while NO worker runs. A full web+worker
  // restart must complete the persisted job exactly once, replay the identical
  // command receipt and leave exactly one ready course.
  const courseText = "Synthetic course restart source. The first sentence is the recall answer.";
  const courseUploaded = await client.post("/api/v1/studies", { headers: { Origin: origin, "Content-Type": "text/plain", "x-filename": "restart-course.txt", "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": crypto.randomUUID() }, data: courseText });
  assert.equal(courseUploaded.status(), 202);
  const courseReceipt = await courseUploaded.json() as Receipt;
  const coursePath = `/api/v1/studies/${courseReceipt.rootId}`;
  await expect.poll(async () => (await (await client.get(coursePath)).json()).operation.state, { timeout: 20000 }).toBe("preview");
  const coursePreview = await (await client.get(coursePath)).json();
  const courseAck = await client.post(`/api/v1/batches/${courseReceipt.rootId}/selection`, { headers: { Origin: origin }, data: { ...command(coursePreview.revision), selected: [{ slotId: coursePreview.slots[0].slotId, extractionId: coursePreview.extractionId, acknowledged: true }], excluded: [] } });
  assert.equal(courseAck.status(), 200);
  const courseSelection = await courseAck.json() as Receipt;
  const courseSaved = await client.post(`${coursePath}/plan`, { headers: { Origin: origin }, data: { ...command(courseSelection.revision), selectionId: courseSelection.selectionId, extractionId: coursePreview.extractionId, plan: coursePlan } });
  assert.equal(courseSaved.status(), 200);
  const courseDraft = await courseSaved.json() as Receipt;
  const courseConfirmed = await client.post(`${coursePath}/confirmation`, { headers: { Origin: origin }, data: { ...command(courseDraft.revision), planRevisionId: courseDraft.planRevisionId } });
  assert.equal(courseConfirmed.status(), 200);
  const confirmedRevision = (await courseConfirmed.json() as Receipt).revision;
  const disclosure = await (await client.get("/api/v1/processing")).json() as { configuration: { version: number } };
  assert.equal((await client.post("/api/v1/processing/decision", { headers: { Origin: origin }, data: { ...command(), configurationVersion: disclosure.configuration.version, decision: "granted", acknowledgedTerms: true } })).status(), 200);
  await stop();
  await startWeb();
  const courseCommand = command(confirmedRevision);
  const generated = await client.post(`${coursePath}/course`, { headers: { Origin: origin }, data: courseCommand });
  assert.equal(generated.status(), 202);
  const generation = await generated.json() as Receipt;
  assert.equal(generation.state, "pending");
  const beforeRestart = await (await client.get(`${coursePath}/course`)).json() as { state: string };
  assert.equal(beforeRestart.state, "pending");
  await stop(); await start();
  await expect.poll(async () => (await (await client.get(`${coursePath}/course`)).json() as { state: string }).state, { timeout: 120000 }).toBe("ready");
  const replayed = await (await client.post(`${coursePath}/course`, { headers: { Origin: origin }, data: courseCommand })).json();
  assert.deepEqual(replayed, generation); // identical receipt, no second effect
  const readyCourses = (await database().query("SELECT id,version,status FROM app.generated_course WHERE root_id=$1 AND status='ready'", [courseReceipt.rootId])).rows;
  assert.equal(readyCourses.length, 1);
  assert.equal(readyCourses[0].version, 1);
  assert.equal((await database().query("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='course'", [courseReceipt.rootId])).rows[0].count, 1);
  const ledgerRow = (await database().query("SELECT input_tokens,output_tokens,total_tokens FROM app.ai_dispatch_ledger WHERE owner_id=$1", [owner.userId])).rows;
  assert.equal(ledgerRow.length, 1);
  assert.deepEqual(ledgerRow[0], { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  const recall = await client.post(`${coursePath}/course/recall`, { headers: { Origin: origin }, data: { ...command(confirmedRevision), attempted: "Synthetic course restart source." } });
  assert.equal(recall.status(), 200);
  assert.equal(((await recall.json()) as { outcome: string }).outcome, "correct");
  // Epic-3 story-1 beat: start the required-test attempt on the ready course
  // and submit it once (all correct through the stored snapshot key). A full
  // web+worker restart must leave the attempt, its snapshot and result
  // unchanged, and a replayed submit command yields the identical result
  // with exactly one graded row.
  const assessmentRevision = ((await (await client.get(coursePath)).json()) as { revision: number }).revision;
  const assessmentStart = await client.post(`${coursePath}/assessment`, { headers: { Origin: origin }, data: command(assessmentRevision) });
  assert.equal(assessmentStart.status(), 200);
  const attemptReceipt = await assessmentStart.json() as Receipt;
  const attemptSnapshot = (await database().query<{ snapshot: { items: Array<{ position: number; answerId: string }> } }>("SELECT snapshot FROM app.test_attempt WHERE id=$1", [attemptReceipt.operationId])).rows[0].snapshot;
  const attemptAnswers = attemptSnapshot.items.map(item => ({ position: item.position, choiceId: item.answerId }));
  const submitCommand = command(assessmentRevision);
  const submitted = await client.post(`${coursePath}/assessment/${attemptReceipt.operationId}/submit`, { headers: { Origin: origin }, data: { ...submitCommand, attemptId: attemptReceipt.operationId, answers: attemptAnswers } });
  assert.equal(submitted.status(), 200);
  const gradedResult = await submitted.json() as { passed: boolean; verdict: string };
  assert.equal(gradedResult.passed, true);
  assert.equal(gradedResult.verdict, "100.0% — Pass (mark is 80%)");
  const assessmentBefore = await (await client.get(`${coursePath}/assessment`)).json();
  await stop(); await start();
  assert.deepEqual(await (await client.get(`${coursePath}/assessment`)).json(), assessmentBefore);
  const replayedSubmit = await client.post(`${coursePath}/assessment/${attemptReceipt.operationId}/submit`, { headers: { Origin: origin }, data: { ...submitCommand, attemptId: attemptReceipt.operationId, answers: attemptAnswers } });
  assert.equal(replayedSubmit.status(), 200);
  assert.deepEqual(await replayedSubmit.json(), gradedResult); // identical result, one receipt
  assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.test_attempt WHERE id=$1 AND status='graded'", [attemptReceipt.operationId])).rows[0].count, 1);
  // Epic-3 story-2 beat: a FAILED ordinary grade opens the recovery ledger
  // (this one-objective course ledgers obj0 open at 7996/10000), a targeted
  // retest clears it, and a full web+worker restart must leave the ledger,
  // the cleared target, the retest and its result unchanged — with a
  // replayed retest submit yielding the identical result and exactly one
  // graded retest row.
  const recoveryAttemptResponse = await client.post(`${coursePath}/assessment`, { headers: { Origin: origin }, data: command(assessmentRevision) });
  assert.equal(recoveryAttemptResponse.status(), 200);
  const recoveryAttempt = await recoveryAttemptResponse.json() as Receipt;
  const recoverySnapshot = (await database().query<{ snapshot: { items: Array<{ position: number; answerId: string; choices: Array<{ id: string }> }> } }>("SELECT snapshot FROM app.test_attempt WHERE id=$1", [recoveryAttempt.operationId])).rows[0].snapshot;
  const recoveryWrongFifth = recoverySnapshot.items[4].choices.find(choice => choice.id !== recoverySnapshot.items[4].answerId)!.id;
  const recoverySubmitCommand = command(assessmentRevision);
  const failedResponse = await client.post(`${coursePath}/assessment/${recoveryAttempt.operationId}/submit`, { headers: { Origin: origin }, data: { ...recoverySubmitCommand, attemptId: recoveryAttempt.operationId, answers: recoverySnapshot.items.map(item => ({ position: item.position, choiceId: item.position === 5 ? recoveryWrongFifth : item.answerId })) } });
  assert.equal(failedResponse.status(), 200);
  const failedResult = await failedResponse.json() as { passed: boolean; verdict: string };
  assert.equal(failedResult.passed, false);
  assert.equal(failedResult.verdict, "79.96% — Not passed (mark is 80%)");
  const ledgerBefore = (await database().query<{ objective_index: number; initial_earned: number; initial_total: number; status: string }>("SELECT objective_index,initial_earned,initial_total,status FROM app.recovery_target WHERE root_attempt_id=$1", [recoveryAttempt.operationId])).rows;
  assert.equal(ledgerBefore.length, 1);
  assert.deepEqual(ledgerBefore[0], { objective_index: 0, initial_earned: 7996, initial_total: 10000, status: "open" });
  const retestStartCommand = command(assessmentRevision);
  const retestStartResponse = await client.post(`${coursePath}/assessment/retest`, { headers: { Origin: origin }, data: { ...retestStartCommand, attemptId: recoveryAttempt.operationId, targetIndexes: [0] } });
  assert.equal(retestStartResponse.status(), 200);
  const retestStart = await retestStartResponse.json() as { operationId: string; targetIndexes: number[] };
  assert.deepEqual(retestStart.targetIndexes, [0]);
  const retestRow = (await database().query<{ snapshot: { items: Array<{ position: number; answerId: string }> } }>("SELECT snapshot FROM app.retest_attempt WHERE id=$1", [retestStart.operationId])).rows[0];
  const retestAnswers = retestRow.snapshot.items.map(item => ({ position: item.position, choiceId: item.answerId }));
  const retestSubmitCommand = command(assessmentRevision);
  const retestSubmitted = await client.post(`${coursePath}/assessment/retest/${retestStart.operationId}/submit`, { headers: { Origin: origin }, data: { ...retestSubmitCommand, retestId: retestStart.operationId, answers: retestAnswers } });
  assert.equal(retestSubmitted.status(), 200);
  const retestResult = await retestSubmitted.json() as { groups: Array<{ objectiveIndex: number; cleared: boolean }> };
  assert.equal(retestResult.groups.length, 1);
  assert.equal(retestResult.groups[0].cleared, true);
  const recoveryBefore = await (await client.get(`${coursePath}/assessment`)).json();
  await stop(); await start();
  assert.deepEqual(await (await client.get(`${coursePath}/assessment`)).json(), recoveryBefore);
  const replayedRetest = await client.post(`${coursePath}/assessment/retest/${retestStart.operationId}/submit`, { headers: { Origin: origin }, data: { ...retestSubmitCommand, retestId: retestStart.operationId, answers: retestAnswers } });
  assert.equal(replayedRetest.status(), 200);
  assert.deepEqual(await replayedRetest.json(), retestResult); // identical result, one receipt
  assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.retest_attempt WHERE id=$1 AND status='graded'", [retestStart.operationId])).rows[0].count, 1);
  assert.equal((await database().query<{ status: string }>("SELECT status FROM app.recovery_target WHERE root_attempt_id=$1", [recoveryAttempt.operationId])).rows[0].status, "cleared");
  // Epic-2 S2 beat: queue the supplement pass while NO worker runs, then a
  // full web+worker restart must complete the persisted job exactly once with
  // a verified attributed supplement and one 'supplement' lifecycle object.
  const courseId = (await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE root_id=$1 AND status='ready'", [courseReceipt.rootId])).rows[0].id;
  await stop();
  await startWeb();
  const supplementCommand = command(confirmedRevision);
  const supplementResponse = await client.post(`${coursePath}/supplements`, { headers: { Origin: origin }, data: { ...supplementCommand, courseId } });
  assert.equal(supplementResponse.status(), 202);
  const supplementGeneration = await supplementResponse.json() as Receipt;
  assert.equal(supplementGeneration.state, "pending");
  await stop(); await start();
  await expect.poll(async () => (await (await client.get(`${coursePath}/supplements?course=${courseId}`)).json() as { state: string }).state, { timeout: 120000 }).toBe("ready");
  const supplements = await (await client.get(`${coursePath}/supplements?course=${courseId}`)).json() as { state: string; gaps: Array<{ outcome: string; supplement: { outcome: string; passage: string | null; origin: string } | null }> };
  assert.equal(supplements.gaps.length, 1);
  assert.equal(supplements.gaps[0].outcome, "supported");
  assert.ok(supplements.gaps[0].supplement?.passage?.includes("coverage"), "verified passage persisted");
  assert.equal(supplements.gaps[0].supplement?.origin, "docs.example.org");
  const replayedSupplement = await (await client.post(`${coursePath}/supplements`, { headers: { Origin: origin }, data: { ...supplementCommand, courseId } })).json();
  assert.deepEqual(replayedSupplement, supplementGeneration); // identical receipt, no second effect
  assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.supplement_request WHERE course_id=$1 AND status='ready'", [courseId])).rows[0].count, 1);
  assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1", [courseId])).rows[0].count, 1);
  assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_object WHERE root_id=$1 AND kind='supplement'", [courseReceipt.rootId])).rows[0].count, 1);
  assert.equal((await database().query("SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1", [owner.userId])).rows[0].count, 2);
  const courseStudy = await (await client.get(coursePath)).json();
  assert.equal((await client.post(`${coursePath}/removal`, { headers: { Origin: origin }, data: command(courseStudy.revision) })).status(), 200);
  assert.equal((await database().query("SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1", [courseId])).rows[0].count, 0);
  for (const secret of [text, courseText, owner.email, owner.password, other.email, other.password]) assert.ok(!output.join("").includes(secret), "Private data reached process output");
  console.log("Restart smoke passed: exact plan/session persisted, B denied, queued PDF recovered with the same original and one extraction, duplicate receipt replayed, course generation queued without a worker completed exactly once across restart with an identical replayed receipt and one ready course, recall answer released only on submission, required-test attempt and graded result survived the restart unchanged with a replayed submit yielding the identical result and one graded row, the failed-attempt recovery ledger opened at grade time and its cleared target, retest and graded retest result survived the restart unchanged with a replayed retest submit yielding the identical result and one graded retest row, supplement pass queued without a worker completed exactly once with a verified attributed supplement and purged with its root; process output content-free.");
} finally { await stop(); await client.dispose(); await denied.dispose(); await closeDatabase(); }