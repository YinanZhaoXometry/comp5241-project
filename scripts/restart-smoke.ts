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
  // Epic-5 entry-1 beat: the manual-course approval-enrollment tracer. The
  // instructor creates a course, drafts one manual lesson, approves the exact
  // version (approver/time/version recorded), enrolls one verified learner
  // through the single-row preview/confirm action — then a full web+worker
  // restart must leave the approved version immutable and identical, the
  // learner study path unchanged, and the no-existence-leak denial standing
  // for a second instructor. A replayed approve command returns one receipt
  // with exactly one approval row.
  const instructor5 = await provisionSynthetic("restart-instructor", "instructor");
  const learner5 = await provisionSynthetic("restart-learner", "learner");
  const denied5 = await provisionSynthetic("restart-second-instructor", "instructor");
  const studio = await request.newContext({ baseURL: origin });
  const study5 = await request.newContext({ baseURL: origin });
  const foreign5 = await request.newContext({ baseURL: origin });
  try {
    for (const [context, account] of [[studio, instructor5], [study5, learner5], [foreign5, denied5]] as const) {
      assert.equal((await context.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: account.email, password: account.password } })).status(), 200);
    }
    const created5 = await studio.post("/api/v1/instructor/courses", { headers: { Origin: origin }, data: { ...command(), title: "Restart instructor course" } });
    assert.equal(created5.status(), 201);
    const course5 = await created5.json() as { courseId: string };
    const draft5 = await studio.post(`/api/v1/instructor/courses/${course5.courseId}/draft`, { headers: { Origin: origin }, data: { ...command(), courseId: course5.courseId, lesson: { title: "Restart manual lesson", sections: [{ text: "Synthetic restart manual lesson body. No AI." }] } } });
    assert.equal(draft5.status(), 200);
    const version5 = (await draft5.json()) as { versionId: string };
    const approve5Command = { ...command(), courseId: course5.courseId, versionId: version5.versionId };
    const approve5 = await studio.post(`/api/v1/instructor/courses/${course5.courseId}/approve`, { headers: { Origin: origin }, data: approve5Command });
    assert.equal(approve5.status(), 200);
    const approval5 = await approve5.json() as { state: string; approvalId: string };
    assert.equal(approval5.state, "approved");
    const preview5 = await studio.post(`/api/v1/instructor/courses/${course5.courseId}/enrollment-preview`, { headers: { Origin: origin }, data: { schemaVersion: 1, name: "Restart Learner", email: learner5.email } });
    assert.equal(preview5.status(), 200);
    assert.equal(((await preview5.json()) as { matched: boolean }).matched, true);
    const enroll5 = await studio.post(`/api/v1/instructor/courses/${course5.courseId}/enrollment`, { headers: { Origin: origin }, data: { ...command(), courseId: course5.courseId, name: "Restart Learner", email: learner5.email } });
    assert.equal(enroll5.status(), 200);
    const detail5Before = await (await studio.get(`/api/v1/instructor/courses/${course5.courseId}`)).json();
    const study5Before = await (await study5.get(`/api/v1/enrollments/${course5.courseId}`)).json();
    assert.equal((study5Before as { state: string }).state, "ready");
    await stop(); await start();
    assert.deepEqual(await (await studio.get(`/api/v1/instructor/courses/${course5.courseId}`)).json(), detail5Before);
    assert.deepEqual(await (await study5.get(`/api/v1/enrollments/${course5.courseId}`)).json(), study5Before);
    assert.equal((await foreign5.get(`/api/v1/enrollments/${course5.courseId}`)).status(), 404);
    // The approved version is immutable across restarts (AD-5).
    await assert.rejects(() => database().query("UPDATE app.instructor_course_version SET content='{\"tampered\":true}' WHERE id=$1", [version5.versionId]), /Immutable revision/);
    // A replayed approve command returns the identical receipt with exactly
    // one approval row, and the enrollment stays single.
    const replay5 = await studio.post(`/api/v1/instructor/courses/${course5.courseId}/approve`, { headers: { Origin: origin }, data: approve5Command });
    assert.equal(replay5.status(), 200);
    assert.deepEqual(await replay5.json(), approval5);
    assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.instructor_approval WHERE version_id=$1", [version5.versionId])).rows[0].count, 1);
    assert.equal((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.instructor_enrollment WHERE course_id=$1", [course5.courseId])).rows[0].count, 1);
    // The tracer's records register in the epic-1 lifecycle inventory.
    const inventory5 = (await (await study5.post("/api/v1/personal/removal", { headers: { Origin: origin }, data: { schemaVersion: 1, preview: true } })).json()) as { categories: Array<{ key: string; count: number }> };
    assert.equal(inventory5.categories.find(category => category.key === "instructor-enrollments")?.count, 1);
  } finally {
    await studio.dispose(); await study5.dispose(); await foreign5.dispose();
  }
  for (const secret of [text, courseText, owner.email, owner.password, other.email, other.password, instructor5.email, instructor5.password, learner5.email, learner5.password, denied5.email, denied5.password]) assert.ok(!output.join("").includes(secret), "Private data reached process output");
  console.log("Restart smoke passed: exact plan/session persisted, B denied, queued PDF recovered with the same original and one extraction, duplicate receipt replayed, course generation queued without a worker completed exactly once across restart with an identical replayed receipt and one ready course, recall answer released only on submission, required-test attempt and graded result survived the restart unchanged with a replayed submit yielding the identical result and one graded row, supplement pass queued without a worker completed exactly once with a verified attributed supplement and purged with its root, instructor course approved version and enrollment survived the restart immutable with one replayed approval receipt and the second instructor denied; process output content-free.");
} finally { await stop(); await client.dispose(); await denied.dispose(); await closeDatabase(); }