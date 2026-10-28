import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import type { AttemptSnapshot } from "../../src/contracts/assessment";
import type { Receipt } from "../../src/contracts/setup";

// Epic-3 story-1 browser journey: over a generated course, A reads the
// pre-start disclosure (threshold, available points, scoring criteria),
// starts the required test, submits a boundary-honest 79.96% attempt (wrong
// only on the 2004-point fifth item) that reads Not passed with the node In
// progress, then retakes all-correct to Pass with the node Completed — the
// derived roadmap line moving exactly with the evidence. B (another learner)
// is denied with no leak; every pre-grade GET payload withholds the answer
// key; the flow stays keyboard-operable and overflow-free at 360px. Synthetic
// account and content only; the assessment dispatches nothing — zero
// outbound requests.
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

async function uploadAndConfirm(page: Page) {
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
  await page.getByLabel("Learning outcomes").fill(outcomes.join("\n"));
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
