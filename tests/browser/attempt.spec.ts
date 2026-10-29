import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { insertAttempt } from "../../src/modules/assessment-progress/repository";
import { insertPracticeAttempt } from "../../src/modules/course-generation/repository";
import { buildPartialCreditSnapshot } from "../../src/modules/assessment-progress/bank";
import type { AttemptSnapshot, RetestSnapshot } from "../../src/contracts/assessment";
import type { Receipt } from "../../src/contracts/setup";

// Epic-3 story-1 browser journey plus the story-2 targeted-recovery journey
// and the story-3 partial-credit disclosure journey.
// Journey 1: over a generated course, A reads the pre-start disclosure
// (threshold, available points, scoring criteria), starts the required test,
// submits a boundary-honest 79.96% attempt (wrong only on the 2004-point
// fifth item) that reads Not passed with the node In progress, then retakes
// all-correct to Pass with the node Completed — the derived roadmap line
// moving exactly with the evidence. Journey 2 (recovery): A fails the same
// boundary attempt, sees the failed view grouped per objective ("Needs
// practice", cause unnamed) plus the recovery ledger, clears the one failed
// group through a fresh same-demand retest, and the node COMPLETES on
// recovery credit with the original verdict still shown beside it — never
// merged, never averaged, zero passing rows. Journey 3 (partial credit): A's
// study carries an open attempt snapshotted at the hundredths scale with a
// disclosed per-item rubric (planted through the module's own writer — the
// surface is builder + contract, no served start path exists in personal
// study); the panel discloses the rubric BEFORE any answer with per-choice
// credit hints that name credit and never the correct answer, the declared
// partly-correct choice earns EXACTLY its disclosed 1999.00 of 4000.00
// points, and the honest 79.99% boundary keeps the node In progress — the
// display never contradicting the verdict under the declared scale.
// B (another learner) is denied on the retest verbs too with no leak; every
// pre-grade GET payload withholds the answer key; the flows stay
// keyboard-operable and overflow-free at 360px. Synthetic account and
// content only; the assessment dispatches nothing — zero outbound requests.
const origin = "http://127.0.0.1:3000";
const sources = [
  { name: "attempt-0.txt", text: "Synthetic assessment source one. A second sentence gives the lesson body some structure." },
  { name: "attempt-1.txt", text: "Synthetic assessment source two. Doubles and coverage appear here for a second section." },
];
const outcomes = ["Recall the first source", "Explain the second source"];

test.beforeEach(async () => { await database().query('DELETE FROM auth."rateLimit"'); });
test.afterAll(async () => { await closeDatabase(); });

async function login(page: Page, label: string) {
  const account = await provisionSynthetic(label, "learner");
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  return account;
}

async function currentConfiguration() {
  const max = await database().query<{ version: number; eligibility: string; daily_admission_limit: number }>("SELECT version, eligibility, daily_admission_limit FROM app.processor_configuration ORDER BY version DESC LIMIT 1");
  return max.rows[0];
}
async function eligibleConfigurationVersion() {
  const current = await currentConfiguration();
  // Eligible WITH a usable quota (sibling suites can leave an eligible
  // limit-1 boundary fixture as the current version); otherwise pin a
  // clearly-labeled eligible fixture above it.
  if (current?.eligibility === "eligible" && current.daily_admission_limit >= 2) return current.version;
  const version = current ? current.version + 1 : 1;
  await database().query(
    `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
     VALUES($1,$2,'Synthetic test spy (local only — not compliant live AI)','Boundary demonstration purpose','["synthetic excerpts"]'::jsonb,'Synthetic test configuration. Nothing leaves this machine.','eligible',true,20)`,
    [crypto.randomUUID(), version],
  );
  return version;
}

async function grantConsent(page: Page) {
  const configurationVersion = await eligibleConfigurationVersion();
  const decision = await page.request.post("/api/v1/processing/decision", {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, configurationVersion, decision: "granted", acknowledgedTerms: true },
  });
  expect(decision.status()).toBe(200);
}

async function uploadAndConfirm(page: Page, flowOutcomes: string[] = outcomes) {
  await page.getByLabel("Synthetic study materials").setInputFiles(sources.map(source => ({ name: source.name, mimeType: "text/plain", buffer: Buffer.from(source.text) })));
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const batch = (await (await created).json()) as Receipt;
  for (const source of sources) {
    await page.getByRole("button", { name: `Inspect preview · ${source.name}`, exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: `Acknowledge and select ${source.name}`, exact: false });
    await checkbox.waitFor({ state: "visible", timeout: 120000 });
    await checkbox.check();
  }
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic assessment topic");
  await page.getByLabel("Learning outcomes").fill(flowOutcomes.join("\n"));
  await page.getByLabel("Source coverage / missing explanations", { exact: false }).fill("Coverage not assessed. No supplementary sources fetched.");
  await page.getByLabel("One mini-course title").fill("Assessment tracer");
  await page.getByLabel("Lessons · one per line").fill(["One generated lesson"].join("\n"));
  await page.getByLabel("Practice activity").fill("Submit one recall item");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  return batch.rootId;
}

// The stored snapshot of the study's open/graded attempt (server-side truth
// the journey grades against — the page never sees the key before grading).
async function snapshotOf(rootId: string): Promise<AttemptSnapshot> {
  const row = await database().query<{ snapshot: AttemptSnapshot }>(
    "SELECT snapshot FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1",
    [rootId],
  );
  if (!row.rows[0]) throw new Error("no attempt row");
  return row.rows[0].snapshot;
}

// The stored snapshot of the study's open retest (server-side truth only —
// the retest answer key never reaches the page before the retest grades).
async function retestSnapshotOf(rootId: string): Promise<RetestSnapshot> {
  const row = await database().query<{ snapshot: RetestSnapshot }>(
    "SELECT snapshot FROM app.retest_attempt WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1",
    [rootId],
  );
  if (!row.rows[0]) throw new Error("no retest row");
  return row.rows[0].snapshot;
}

test("A takes the required test: honest 79.96% boundary keeps the node In progress; a passing retake Completes it; B is denied", async ({ page, playwright }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const assessmentBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/assessment") && response.request().method() === "GET") assessmentBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "attempt-browser-a");
  await grantConsent(page);
  const rootId = await uploadAndConfirm(page);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assessment & progress", exact: true }) });
  // The course generates; once ready, the assessment panel's quiet re-read
  // offers the test (2-second poll — no focus steal).
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(coursePanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel).toBeVisible({ timeout: 15000 });
  // Pre-start disclosure: threshold, available points, scoring criteria — and
  // the roadmap line starts Not started.
  await expect(panel.getByText("Roadmap: Not started.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Pass mark: 80%", { exact: false })).toBeVisible();
  await expect(panel.getByText("1999 + 1999 + 1999 + 1999 + 2004 = 10000 points", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Single choice per item/)).toBeVisible();
  await expect(panel.getByText(/Full credit only/)).toBeVisible();
  // Pre-grade withholding: no served payload carries the answer key.
  const offeredPayload = await (await page.request.get(`/api/v1/studies/${rootId}/assessment`)).json() as unknown;
  expect(JSON.stringify(offeredPayload)).not.toContain('"answerId"');
  expect(JSON.stringify(offeredPayload)).not.toContain('"correctChoiceId"');
  // Mark the course's required reading done first — Completed needs it.
  await coursePanel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true }).click();
  await expect(coursePanel.getByText(/^Done\./).first()).toBeVisible();
  // Keyboard start: focus the action, submit with Enter.
  const start = panel.getByRole("button", { name: "Start the required test", exact: true });
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const snapshot = await snapshotOf(rootId);
  expect(snapshot.items).toHaveLength(5);
  const textOf = (position: number, choiceId: string) => {
    const item = snapshot.items.find(candidate => candidate.position === position)!;
    return item.choices.find(choice => choice.id === choiceId)!.text;
  };
  // Item 1 keyboard-only: focus its first radio, Space to choose the correct
  // answer, then submit the item's form area is shared — the radios are the
  // only inputs; choose the correct answer for items 1–4 by label.
  await page.getByRole("radio", { name: textOf(1, snapshot.items[0].answerId), exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: textOf(1, snapshot.items[0].answerId), exact: true })).toBeChecked();
  for (const item of snapshot.items.slice(1, 4)) await page.getByRole("radio", { name: textOf(item.position, item.answerId), exact: true }).check();
  // The 2004-point fifth item answered WRONG: correct on the first four
  // earns 7996/10000 = 79.96% — the honest boundary below the 80% mark.
  const wrongFifth = snapshot.items[4].choices.find(choice => choice.id !== snapshot.items[4].answerId)!;
  await page.getByRole("radio", { name: wrongFifth.text, exact: true }).check();
  // Keyboard submit: the button enables once every item is answered.
  const submit = panel.getByRole("button", { name: "Submit test (5/5 answered)", exact: true });
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  // The honest boundary verdict and the node staying In progress. The verdict
  // line appears in the graded <strong> (the notice output carries it too, so
  // the assertion targets the strong role to stay strict-mode clean).
  await expect(panel.getByRole("strong").filter({ hasText: "79.96% — Not passed (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Roadmap: In progress.", { exact: true })).toBeVisible();
  await expect(panel.getByText("7996/10000 points", { exact: false }).first()).toBeVisible();
  // The graded view reveals per-item correct answers — the sole reveal path.
  await expect(panel.getByText("Correct answer:", { exact: false }).first()).toBeVisible();
  // Retake: a fresh attempt, all correct — Pass and the derived node moves.
  await panel.getByRole("button", { name: "Start a new attempt", exact: true }).click();
  await expect(panel.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const retakeSnapshot = await snapshotOf(rootId);
  for (const item of retakeSnapshot.items) await page.getByRole("radio", { name: textOf(item.position, item.answerId), exact: true }).check();
  await panel.getByRole("button", { name: "Submit test (5/5 answered)", exact: true }).click();
  await expect(panel.getByRole("strong").filter({ hasText: "100.0% — Pass (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Roadmap: Completed.", { exact: true })).toBeVisible();
  // Story 4: the passing retake earned exactly one version-scoped award — the
  // awards line lists it (with its timestamp), version-scoped and never
  // overwritten.
  await expect(panel.getByText(/Completion awards/)).toBeVisible();
  await expect(panel.getByText(/Mini-course version 1 — completed /)).toBeVisible();
  // History: both attempts listed, never overwritten.
  await expect(panel.getByText(/Attempt history/)).toBeVisible();
  await expect(panel.getByText(/open — not yet submitted/)).toHaveCount(0);
  // Exactly one passing row and one failing row server-side; exactly-once
  // replay of the failed submit command returns the identical receipt.
  const rows = await database().query<{ status: string; passed: boolean }>(
    "SELECT status,passed FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at",
    [rootId],
  );
  expect(rows.rows.map(row => [row.status, row.passed])).toEqual([["graded", false], ["graded", true]]);
  // Every GET payload across the whole journey never carried the snapshot's
  // answer-key field (post-grade payloads legitimately carry correctChoiceId
  // in the graded view — the sole reveal path).
  for (const body of await Promise.all(assessmentBodies)) {
    expect(body).not.toContain('"answerId"');
  }
  // B (another learner) cannot touch A's assessment by any verb — no leak.
  const stranger = await provisionSynthetic("attempt-browser-b", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: stranger.email, password: stranger.password } })).status()).toBe(200);
    expect((await client.get(`/api/v1/studies/${rootId}/assessment`)).status()).toBe(404);
    const denied = await client.post(`/api/v1/studies/${rootId}/assessment`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 } });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("attempt-0.txt");
  } finally { await client.dispose(); }
  // Keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "Assessment & progress", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("assessment-completed.png"), fullPage: true });
});

// Epic-3 story-2 journey: A fails the boundary attempt on the two-objective
// course (wrong only on the 2004-point fifth item fails exactly objective
// group 0 while group 1 passes), reads the focused review grouped per
// objective and the recovery ledger, clears the one open group through a
// fresh same-demand retest — and the node completes on recovery credit with
// the original 79.96% verdict still visible beside the per-group credit,
// never merged. The retest verbs deny a second account with no leak.
test("A fails once, clears the failed group through a targeted retest: node Completes on recovery credit beside the unchanged original verdict", async ({ page, playwright }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const assessmentBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/assessment") && response.request().method() === "GET") assessmentBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "attempt-recovery-browser");
  await grantConsent(page);
  const rootId = await uploadAndConfirm(page);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assessment & progress", exact: true }) });
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(coursePanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel).toBeVisible({ timeout: 15000 });
  // The required reading is done BEFORE the chain so Completed can fire on
  // recovery credit alone — with zero passing ordinary attempts.
  await coursePanel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true }).click();
  await expect(coursePanel.getByText(/^Done\./).first()).toBeVisible();
  // Fail exactly objective group 0 (items 1, 3, 5 of the two-objective
  // mapping): wrong only on the 2004-point fifth item — 79.96% overall,
  // group 0 at 3998/6002, group 1 fully passed and preserved.
  await panel.getByRole("button", { name: "Start the required test", exact: true }).click();
  await expect(panel.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const snapshot = await snapshotOf(rootId);
  const textOf = (position: number, choiceId: string) => {
    const item = snapshot.items.find(candidate => candidate.position === position)!;
    return item.choices.find(choice => choice.id === choiceId)!.text;
  };
  for (const item of snapshot.items.slice(0, 4)) await page.getByRole("radio", { name: textOf(item.position, item.answerId), exact: true }).check();
  const wrongFifth = snapshot.items[4].choices.find(choice => choice.id !== snapshot.items[4].answerId)!;
  await page.getByRole("radio", { name: wrongFifth.text, exact: true }).check();
  // Pre-grade withholding on the ORDINARY attempt: capture every payload
  // served so far (offered + active states) BEFORE the submit — the graded
  // refresh that follows the submit legitimately carries the reveal.
  const preGradeBodies = await Promise.all(assessmentBodies.splice(0));
  await panel.getByRole("button", { name: "Submit test (5/5 answered)", exact: true }).click();
  await expect(panel.getByRole("strong").filter({ hasText: "79.96% — Not passed (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  // The failed view groups items per objective: the failed group reads
  // "Needs practice" (cause unnamed), the passed group "Passed — preserved".
  // The story-5 guidance callout renders the same D2 label below the focused
  // review, so the strong is asserted on its FIRST match — the focused-review
  // group, which renders before the callout in the graded block.
  await expect(panel.getByRole("strong").filter({ hasText: "Needs practice" }).first()).toBeVisible();
  await expect(panel.getByRole("strong").filter({ hasText: "Passed — preserved" })).toBeVisible();
  // The recovery ledger: exactly the failed group, open, with its initial
  // result; the failed-test requirement honestly unsatisfied.
  await expect(panel.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();
  await expect(panel.getByText(/initial 3998\/6002/).first()).toBeVisible();
  await expect(panel.getByText("Failed-test requirement: open — 1 target group uncleared.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Roadmap: In progress.", { exact: true })).toBeVisible();
  for (const body of preGradeBodies) {
    expect(body).not.toContain('"answerId"');
    expect(body).not.toContain('"correctChoiceId"');
  }
  // Keyboard start of the targeted retest (the one open group is preselected).
  const retestStart = panel.getByRole("button", { name: "Start targeted retest (1 of 1 open group)", exact: true });
  await retestStart.focus();
  await expect(retestStart).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Retest open — 3 fresh items/)).toBeVisible({ timeout: 15000 });
  // Pre-grade withholding on the RETEST: the active retest view in the
  // served state carries prompts and choices only (the attempt's own graded
  // reveal is its separate, already-earned path).
  const retestOpenState = await (await page.request.get(`/api/v1/studies/${rootId}/assessment`)).json() as { recovery: { retest: unknown } | null };
  const retestSerialized = JSON.stringify(retestOpenState.recovery?.retest ?? null);
  expect(retestSerialized).not.toContain("answerId");
  expect(retestSerialized).not.toContain("correctChoiceId");
  // Fresh questions: the retest prompts differ from the original attempt's.
  const retestSnapshot = await retestSnapshotOf(rootId);
  expect(retestSnapshot.items).toHaveLength(3);
  expect(retestSnapshot.items.map(item => [item.objectiveIndex, item.points])).toEqual([[0, 1999], [0, 1999], [0, 2004]]);
  for (const item of retestSnapshot.items) expect(item.prompt).not.toBe(snapshot.items[item.position - 1].prompt);
  const retestTextOf = (position: number, choiceId: string) => {
    const item = retestSnapshot.items.find(candidate => candidate.position === position)!;
    return item.choices.find(choice => choice.id === choiceId)!.text;
  };
  // Keyboard-only on the first item, then answer the rest correctly.
  await page.getByRole("radio", { name: retestTextOf(1, retestSnapshot.items[0].answerId), exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: retestTextOf(1, retestSnapshot.items[0].answerId), exact: true })).toBeChecked();
  for (const item of retestSnapshot.items.slice(1)) await page.getByRole("radio", { name: retestTextOf(item.position, item.answerId), exact: true }).check();
  const retestSubmit = panel.getByRole("button", { name: "Submit retest (3/3 answered)", exact: true });
  await retestSubmit.focus();
  await expect(retestSubmit).toBeFocused();
  await page.keyboard.press("Enter");
  // The group cleared: requirement satisfied, node Completed on recovery
  // credit — while the original verdict stays visible beside it, never
  // merged, and zero passing ordinary rows exist server-side.
  await expect(panel.getByText("Failed-test requirement: satisfied.", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByRole("heading", { name: "Retest result", exact: true })).toBeVisible();
  await expect(panel.getByText(/cleared/, { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("Roadmap: Completed.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("strong").filter({ hasText: "79.96% — Not passed (mark is 80%)" })).toBeVisible();
  await expect(panel.getByText(/never merged/i).first()).toBeVisible();
  const rows = await database().query<{ status: string; passed: boolean | null }>(
    "SELECT status,passed FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at",
    [rootId],
  );
  expect(rows.rows).toEqual([{ status: "graded", passed: false }]);
  const ledger = await database().query<{ objective_index: number; status: string }>(
    "SELECT objective_index,status FROM app.recovery_target WHERE root_id=$1",
    [rootId],
  );
  expect(ledger.rows).toEqual([{ objective_index: 0, status: "cleared" }]);
  // History: the failed attempt and the graded retest listed, never overwritten.
  await expect(panel.getByText(/Attempt history/)).toBeVisible();
  await expect(panel.getByText(/Retest history/)).toBeVisible();
  // Post-grade payloads legitimately carry correctChoiceId in graded views —
  // the sole reveal path — but never the raw answerId field.
  for (const body of await Promise.all(assessmentBodies)) {
    expect(body).not.toContain('"answerId"');
  }
  // B (another learner) cannot touch A's recovery by any verb — no leak.
  const stranger = await provisionSynthetic("attempt-recovery-browser-b", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: stranger.email, password: stranger.password } })).status()).toBe(200);
    expect((await client.get(`/api/v1/studies/${rootId}/assessment`)).status()).toBe(404);
    const deniedStart = await client.post(`/api/v1/studies/${rootId}/assessment/retest`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, attemptId: crypto.randomUUID(), targetIndexes: [0] } });
    expect(deniedStart.status()).toBe(404);
    expect(await deniedStart.text()).not.toContain("attempt-0.txt");
    expect((await client.post(`/api/v1/studies/${rootId}/assessment/retest/${crypto.randomUUID()}/submit`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, retestId: crypto.randomUUID(), answers: [] } })).status()).toBe(404);
  } finally { await client.dispose(); }
  // Keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "Assessment & progress", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("recovery-completed.png"), fullPage: true });
});

// Epic-3 story-3 journey: the disclosed partial-credit surface over an open
// attempt snapshotted at the hundredths scale. The rubric disclosure and the
// per-choice credit hints are visible BEFORE any answer (and name no correct
// answer); choosing the declared partly-correct option earns EXACTLY its
// disclosed 1999.00 of 4000.00 points; 6000.00 + 1999.00 = 79.99% honestly
// fails the 80% mark with a two-decimal display (the one-decimal "80.0%"
// would contradict the verdict) and the node stays In progress.
test("A answers a disclosed partial-credit item: the declared credit is earned exactly and the honest 79.99% boundary keeps the node In progress", async ({ page }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const assessmentBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/assessment") && response.request().method() === "GET") assessmentBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  const account = await login(page, "attempt-partial-browser");
  await grantConsent(page);
  const rootId = await uploadAndConfirm(page);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assessment & progress", exact: true }) });
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(coursePanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });

  // Plant the open attempt through the module's own repository writer with
  // the module's own fixture builder: a scale-100 snapshot whose second item
  // carries the disclosed rubric. Same row shape a started attempt carries;
  // no served start path builds it in personal study.
  const courseRow = (
    await database().query<{ id: string; version: number; plan_revision_id: string }>(
      "SELECT id,version,plan_revision_id FROM app.generated_course WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1",
      [rootId],
    )
  ).rows[0];
  if (!courseRow) throw new Error("no course row");
  const objectiveRows = (
    await database().query<{ position: number; objective: string }>(
      "SELECT position,objective FROM app.course_objective WHERE course_id=$1 ORDER BY position",
      [courseRow.id],
    )
  ).rows;
  const snapshot = buildPartialCreditSnapshot(objectiveRows.map(row => ({ index: row.position, text: row.objective })));
  const client = await database().connect();
  try {
    await insertAttempt(client, {
      id: crypto.randomUUID(),
      rootId,
      ownerId: account.userId,
      courseId: courseRow.id,
      courseVersion: courseRow.version,
      planRevisionId: courseRow.plan_revision_id,
      snapshot,
    });
  } finally {
    await client.release();
  }
  await page.reload();
  // The study selection is per page-load: after the reload the library lists
  // the confirmed study — reopen it and the assessment panel serves the
  // planted open attempt.
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View plan", exact: true }).click();
  await expect(panel).toBeVisible({ timeout: 15000 });

  // Pre-answer disclosure: the rubric line names the declared credit, the
  // pass mark stays the default 80, points render in the snapshot's declared
  // scale, and the node honestly reports engagement — no pass anywhere.
  await expect(panel.getByText("Attempt open — 0 of 2 answered.", { exact: false })).toBeVisible();
  await expect(panel.getByText(/earns the declared 1999\.00 of 4000\.00 points/)).toBeVisible();
  await expect(panel.getByText("6000.00 + 4000.00 = 10000.00 points", { exact: false })).toBeVisible();
  await expect(panel.getByText("Pass mark: 80%", { exact: false })).toBeVisible();
  await expect(panel.getByText("Roadmap: In progress.", { exact: true })).toBeVisible();

  // The credited choice names its exact credit beside the option — and never
  // the correct answer: the pre-grade payloads carry no key of any kind.
  const creditedId = Object.keys(snapshot.items[1].partialCredit!.credits)[0]!;
  const creditedText = snapshot.items[1].choices.find(choice => choice.id === creditedId)!.text;
  const creditedLabel = `${creditedText} — earns 1999.00 of 4000.00 points if chosen`;
  const preGradeBodies = await Promise.all(assessmentBodies.splice(0));
  for (const body of preGradeBodies) {
    expect(body).not.toContain('"answerId"');
    expect(body).not.toContain('"correctChoiceId"');
  }

  // Keyboard-only on the first (full-credit, hint-free) item; the credited
  // partly-correct choice on the rubric item.
  await page.getByRole("radio", { name: snapshot.items[0].choices.find(choice => choice.id === snapshot.items[0].answerId)!.text, exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: snapshot.items[0].choices.find(choice => choice.id === snapshot.items[0].answerId)!.text, exact: true })).toBeChecked();
  await page.getByRole("radio", { name: creditedLabel, exact: true }).check();
  const submit = panel.getByRole("button", { name: "Submit test (2/2 answered)", exact: true });
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");

  // The honest boundary under the declared scale: exactly the declared credit
  // earned, 79.99% NOT passing 80, two decimals because one would mislead,
  // the partly-correct item labeled with its exact earned amount, and the
  // node staying In progress.
  await expect(panel.getByRole("strong").filter({ hasText: "79.99% — Not passed (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("7999.00/10000.00 points", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("partly correct · 1999.00 of 4000.00 points", { exact: false })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();
  await expect(panel.getByText(/initial 1999\.00\/4000\.00/).first()).toBeVisible();
  await expect(panel.getByText("Failed-test requirement: open — 1 target group uncleared.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Roadmap: In progress.", { exact: true })).toBeVisible();

  // One graded row, zero passing rows; every GET payload across the whole
  // journey never carried the snapshot's answer-key field.
  const rows = await database().query<{ status: string; passed: boolean | null }>(
    "SELECT status,passed FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at",
    [rootId],
  );
  expect(rows.rows).toEqual([{ status: "graded", passed: false }]);
  for (const body of await Promise.all(assessmentBodies)) {
    expect(body).not.toContain('"answerId"');
  }

  // Keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "Assessment & progress", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("partial-credit-graded.png"), fullPage: true });
});

// Epic-3 story-4 journey: the award/switch honesty. A completes version 1
// (required reading done + all-correct attempt) and the node reads Completed
// FROM the earned version-scoped award; a regeneration creates version 2 with
// CHANGED required work (a new lesson-2 reading and a changed required test)
// and the node honestly falls back to In progress while the version-1 award
// stays listed — never erased, never silent. The switch flow discloses the
// changed required work BEFORE any move, a wrong acknowledgment is denied
// server-side (no move), and the confirmed switch back to version 1 restores
// Completed from the existing award. Keyboard-operable and overflow-free at
// 360px; zero outbound requests; no pre-grade answer leak.
test("A earns a version-scoped award, regenerates, and switches back only after the changed-work disclosure", async ({ page }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const assessmentBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/assessment") && response.request().method() === "GET") assessmentBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "attempt-award-switch-browser");
  await grantConsent(page);
  const rootId = await uploadAndConfirm(page);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assessment & progress", exact: true }) });
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(coursePanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel).toBeVisible({ timeout: 15000 });
  // Complete version 1: required reading done, then an all-correct attempt.
  await coursePanel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true }).click();
  await expect(coursePanel.getByText(/^Done\./).first()).toBeVisible();
  await panel.getByRole("button", { name: "Start the required test", exact: true }).click();
  await expect(panel.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const snapshot = await snapshotOf(rootId);
  for (const item of snapshot.items) await page.getByRole("radio", { name: item.choices.find(choice => choice.id === item.answerId)!.text, exact: true }).check();
  await panel.getByRole("button", { name: "Submit test (5/5 answered)", exact: true }).click();
  await expect(panel.getByRole("strong").filter({ hasText: "100.0% — Pass (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Roadmap: Completed.", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Mini-course version 1 — completed /)).toBeVisible();

  // Regenerate version 2 with changed required work through the API (the
  // learner's own confirmed-plan path): a second lesson adds a NEW required
  // reading and the changed outcomes change the required test.
  const study = await (await page.request.get(`/api/v1/studies/${rootId}`)).json() as { revision: number; extractionId: string; selection: { id: string } };
  const secondPlan = {
    topic: "Synthetic assessment topic, second edition",
    goal: "Understand a topic",
    clarification: "",
    outcomes: ["Recall the first source", "Explain the second source", "Recover from a failed test"],
    miniCourse: { title: "Assessment tracer", lessons: ["One generated lesson", "Judging coverage reports"], practice: "Submit one recall item", estimatedMinutes: 20 },
    missingExplanations: "Coverage not assessed. No supplementary sources fetched.",
  };
  const saved = await page.request.post(`/api/v1/studies/${rootId}/plan`, {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: study.revision, selectionId: study.selection.id, extractionId: study.extractionId, plan: secondPlan },
  });
  expect(saved.status()).toBe(200);
  const draft = await saved.json() as { revision: number; planRevisionId: string };
  const confirmed = await page.request.post(`/api/v1/studies/${rootId}/confirmation`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: draft.revision, planRevisionId: draft.planRevisionId } });
  expect(confirmed.status()).toBe(200);
  const confirmedReceipt = await confirmed.json() as { revision: number };
  const generated = await page.request.post(`/api/v1/studies/${rootId}/course`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: confirmedReceipt.revision } });
  expect(generated.status()).toBe(202);
  // The panel's quiet re-read picks version 2 up once it settles; the node
  // honestly falls back to In progress (v2 has its own unawarded condition
  // set) while the v1 award stays listed — never erased by the regeneration.
  await expect(panel.getByText("Roadmap: In progress.", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(/Mini-course version 1 — completed /)).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Study version", exact: true })).toBeVisible();

  // The disclosure BEFORE any move: choosing version 1 and showing what
  // changes names the removed lesson-2 reading and the changed required test.
  await panel.getByLabel("Switch to version", { exact: true }).selectOption("1");
  const showChanges = panel.getByRole("button", { name: "Show what changes", exact: true });
  await showChanges.focus();
  await expect(showChanges).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Changed required work — version 2 → version 1:/)).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Removed — Read lesson 2: Judging coverage reports", { exact: false })).toBeVisible();
  await expect(panel.getByText(/The required test changes on version 1/)).toBeVisible();

  // A wrong acknowledgment is denied server-side and moves nothing: the
  // studied version stays 2 and the node stays honestly In progress.
  const v1CourseId = await versionOneCourseId(rootId);
  const currentStudy = await (await page.request.get(`/api/v1/studies/${rootId}`)).json() as { revision: number };
  const wrongSwitch = await page.request.post(`/api/v1/studies/${rootId}/assessment/switch`, {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: currentStudy.revision, courseId: v1CourseId, acknowledged: { addedRequiredItemIds: [], removedRequiredItemIds: [], requiredTestChanged: false } },
  });
  expect(wrongSwitch.status()).toBe(409);
  await expect(panel.getByText("Roadmap: In progress.", { exact: true })).toBeVisible();

  // The confirmed switch moves the studied release back to version 1: the
  // node reads Completed FROM the existing award — nothing was re-earned and
  // nothing was erased. Keyboard submit on the confirm action.
  const confirm = panel.getByRole("button", { name: "Confirm switch to version 1", exact: true });
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Roadmap: Completed.", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByText("Now studying version 1.", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Mini-course version 1 — completed /)).toBeVisible();
  // Exactly one earned award server-side, still pinning version 1.
  const awardRows = await database().query<{ kind: string; course_version: number }>("SELECT kind,course_version FROM app.completion_award WHERE root_id=$1", [rootId]);
  expect(awardRows.rows).toEqual([{ kind: "mini-course", course_version: 1 }]);
  // No GET payload across the journey ever carried the answer key.
  for (const body of await Promise.all(assessmentBodies)) {
    expect(body).not.toContain('"answerId"');
  }
  // Keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "Assessment & progress", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("switch-completed.png"), fullPage: true });
});

// The version-1 course id of a study (server-side truth for the wrong-ack
// denial probe above).
async function versionOneCourseId(rootId: string): Promise<string> {
  const row = await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE root_id=$1 AND version=1 AND status='ready'", [rootId]);
  if (!row.rows[0]) throw new Error("no version-1 course row");
  return row.rows[0].id;
}

// Epic-3 story-5 journey: an eight-objective course (the five-item blueprint
// covers only the first five, so objectives six through eight stay honestly
// Unknown), planted mixed practice through epic-2's own writer, and the
// boundary-honest 79.96% failed attempt (wrong only on the 2004-point fifth
// item — failing exactly objective group five). The guidance callout names
// the failed group with its cited response and the labeled practice lane
// beside — never merged — marks the unassessed objectives Unknown rather than
// Needs practice, states its uncertainty in text, and offers the one-way
// flag: flagging records the dispute with the evidence and changes no
// outcome. A second account's flag verb is denied with no leak.
test("A reads evidence-linked guidance after a failed attempt: Unknown stays distinct, practice stays labeled, the flag records without changing the verdict", async ({ page, playwright }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  const account = await login(page, "guidance-browser-a");
  await grantConsent(page);
  const eight = ["Recall the first source", "Explain the second source", "Judge coverage reports", "Name the boundary item", "Recover a failed group", "Sixth unassessed objective", "Seventh unassessed objective", "Eighth unassessed objective"];
  const rootId = await uploadAndConfirm(page, eight);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assessment & progress", exact: true }) });
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(coursePanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel).toBeVisible({ timeout: 15000 });
  // Mixed practice BEFORE the attempt, planted through epic-2's own writer on
  // the studied course: the boundary objective's card carries one assisted
  // incorrect and one unaided correct attempt; an unassessed objective's card
  // carries one unaided incorrect attempt.
  const courseRow = (await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE root_id=$1 AND status='ready'", [rootId])).rows[0];
  const plant = await database().connect();
  try {
    await insertPracticeAttempt(plant, { ownerId: account.userId, courseId: courseRow.id, cardId: "practice:4", attempted: "boundary practice attempt", outcome: "incorrect", evidenceKind: "assisted" });
    await insertPracticeAttempt(plant, { ownerId: account.userId, courseId: courseRow.id, cardId: "practice:4", attempted: "second boundary practice attempt", outcome: "correct", evidenceKind: "unaided" });
    await insertPracticeAttempt(plant, { ownerId: account.userId, courseId: courseRow.id, cardId: "practice:6", attempted: "unassessed practice attempt", outcome: "incorrect", evidenceKind: "unaided" });
  } finally { await plant.release(); }
  // Pre-test the guidance is served (every objective honestly Unknown — never
  // "Needs practice" — with the practiced lanes) but renders only on the
  // result surface, so the panel shows no callout yet.
  const preGuidance = ((await (await page.request.get(`/api/v1/studies/${rootId}/assessment`)).json()) as { guidance: { entries: Array<{ status: string; practice: { assistedIncorrect: number } | null }> } }).guidance;
  expect(preGuidance!.entries).toHaveLength(8);
  expect(preGuidance!.entries.every(entry => entry.status === "unknown")).toBe(true);
  expect(preGuidance!.entries[4].practice?.assistedIncorrect).toBe(1);
  await expect(panel.getByRole("heading", { name: "What to study next", exact: true })).toHaveCount(0);
  // The boundary-honest failed attempt: correct on items 1–4, wrong on the
  // 2004-point fifth item — failing exactly objective group five.
  await panel.getByRole("button", { name: "Start the required test", exact: true }).click();
  await expect(panel.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const snapshot = await snapshotOf(rootId);
  for (const item of snapshot.items.slice(0, 4)) await page.getByRole("radio", { name: item.choices.find(choice => choice.id === item.answerId)!.text, exact: true }).check();
  await page.getByRole("radio", { name: snapshot.items[4].choices.find(choice => choice.id !== snapshot.items[4].answerId)!.text, exact: true }).check();
  await panel.getByRole("button", { name: "Submit test (5/5 answered)", exact: true }).click();
  await expect(panel.getByRole("strong").filter({ hasText: "79.96% — Not passed (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  // The guidance block: a note callout (its opening words are unique to the
  // note — the focused review's fine print shares only the later phrase) and
  // one entry row per objective needing attention. One Needs-practice entry
  // citing the specific wrong response; three Unknown entries (the blueprint
  // never reached objectives six through eight); practice lanes labeled.
  // Entry locators scope to the entries wrapper: the focused review above
  // renders the same D2 phrases.
  const guidanceEntries = panel.locator(".guidance-entries");
  await expect(panel.getByRole("heading", { name: "What to study next", exact: true })).toBeVisible();
  await expect(panel.getByText("Needs practice names observed difficulty", { exact: false })).toBeVisible();
  await expect(guidanceEntries.getByText(/^Needs practice · /)).toHaveCount(1);
  await expect(panel.getByText("item 5: 0 of 2004 points", { exact: false })).toBeVisible();
  await expect(guidanceEntries.getByText(/^Unknown · /)).toHaveCount(3);
  // The "not weakness" framing rides each Unknown ENTRY (the uncertainty note
  // carries the same phrase, so the entry form is matched by its em-dash
  // prefix — three entries, never the note's fourth match).
  await expect(guidanceEntries.getByText(" — not yet assessed, not weakness", { exact: false })).toHaveCount(3);
  await expect(panel.getByText("unaided 1 correct / 0 incorrect; assisted 0 correct / 1 incorrect", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Latest incorrect \(assisted\): “boundary practice attempt”/)).toBeVisible();
  // The unassessed objective's practice renders in its own labeled lane while
  // its status stays Unknown — practice never reclassifies.
  await expect(panel.getByText("unaided 0 correct / 1 incorrect; assisted 0 correct / 0 incorrect", { exact: false })).toBeVisible();
  // The citation links to its evidence: the focused-review item anchors exist.
  const attemptId = (await database().query<{ id: string }>("SELECT id FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1", [rootId])).rows[0].id;
  await expect(page.locator(`#attempt-item-${attemptId}-5`)).toBeVisible();
  // The one-way flag: records the dispute with the evidence, changes no
  // outcome — the verdict, points and recovery panel stay exactly as served.
  await panel.getByRole("button", { name: "Flag as unclear", exact: true }).click();
  await expect(panel.getByText("Flagged — the flag is recorded with the evidence; it changes no outcome.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Flag as unclear", exact: true })).toHaveCount(0);
  await expect(panel.getByText("Flagged as unclear — recorded with the evidence.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("strong").filter({ hasText: "79.96% — Not passed (mark is 80%)" })).toBeVisible();
  expect((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.assessment_flag WHERE root_id=$1", [rootId])).rows[0].count).toBe(1);
  // B (another learner) cannot flag A's graded item — no leak.
  const stranger = await provisionSynthetic("guidance-browser-b", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: stranger.email, password: stranger.password } })).status()).toBe(200);
    const denied = await client.post(`/api/v1/studies/${rootId}/assessment/flag`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, evidenceKind: "attempt", evidenceId: attemptId, position: 5 } });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("attempt-0.txt");
  } finally { await client.dispose(); }
  // Keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "Assessment & progress", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("guidance-callout.png"), fullPage: true });
});
