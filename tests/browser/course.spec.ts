import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import type { Receipt } from "../../src/contracts/setup";

// Epic-2 S1 browser journey: A confirms a plan, re-grants processing consent
// under the v5 disclosure, generates the course through the consent-gated
// action, studies the labeled lesson with source locations, and submits the
// recall item whose answer is withheld until then. B is denied. Synthetic
// account and content only; the processor is the local synthetic fixture —
// zero outbound requests.
const origin = "http://127.0.0.1:3000";
const sources = [
  { name: "course-0.txt", text: "Synthetic course source one. A second sentence gives the lesson body some structure." },
  { name: "course-1.txt", text: "Synthetic course source two. Doubles and coverage appear here for a second section." },
];
// The synthetic fixture's canonical recall answer is the first sentence of
// source one, and that source's section teaches from the remainder AFTER it —
// so the answer string itself, the rationale and the feedback labels must all
// stay absent from the page and every GET payload until submission.
const canonicalAnswer = "Synthetic course source one.";
const withheldProbes = [canonicalAnswer, "The opening of course-0.txt states this directly.", "Canonical answer:", "Rationale:"];

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

// The processor_configuration table is shared, ordered state: sibling specs
// (e.g. consent.spec's ineligible boundary rows) can leave the current version
// ineligible. Pin a clearly-labeled eligible fixture ONLY then — on a fresh
// database the journey grants under the honest v5 disclosure the migration
// inserted (mirrors the integration suite's conditional grant()).
async function currentConfiguration() {
  const max = await database().query<{ version: number; eligibility: string }>("SELECT version, eligibility FROM app.processor_configuration ORDER BY version DESC LIMIT 1");
  return max.rows[0];
}
async function eligibleConfigurationVersion() {
  const current = await currentConfiguration();
  if (current?.eligibility === "eligible") return current.version;
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
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic course topic");
  await page.getByLabel("Learning outcomes").fill("Recall the first source\nExplain the second source");
  await page.getByLabel("One mini-course title").fill("Course tracer");
  await page.getByLabel("Lessons · one per line").fill("One generated lesson");
  await page.getByLabel("Practice activity").fill("Submit one recall item");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  return batch.rootId;
}

test("A generates and studies the labeled course; the recall answer is withheld until submission; B is denied", async ({ page, playwright }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const courseBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/course") && response.request().method() === "GET") courseBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "course-browser-a");
  // Consent is granted before the confirmed plan mounts the course stage, so
  // the stage's own disclosure read already sees the v5 grant.
  await grantConsent(page);
  const rootId = await uploadAndConfirm(page);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Plan confirmed — course not generated.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  // The honest pending state appears, then the server-authoritative ready view.
  await expect(panel.getByText(/Course generating|at most 120 seconds/)).toBeVisible();
  const lesson = panel.getByRole("heading", { name: "One generated lesson", exact: true });
  await expect(lesson).toBeVisible({ timeout: 60000 });
  // Focus choreography: after generation the panel heading receives focus.
  await expect(panel.getByRole("heading", { name: "Your mini-course", exact: true })).toBeFocused();
  await expect(panel.getByText("AI-generated · Unreviewed", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Version 1 · generated/)).toBeVisible();
  // Per-section source locations (the recall card repeats its own source line,
  // so the lesson-section occurrence is asserted first).
  await expect(panel.getByText("Source: course-0.txt ·", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("Source: course-1.txt ·", { exact: false }).first()).toBeVisible();
  // Pre-submission withholding: the course view (this panel's DOM) and every
  // course GET payload carry neither the canonical answer string, its field,
  // its label nor the rationale. (The Materials preview above legitimately
  // still shows the owner's OWN uploaded source — the answer's origin — which
  // is owner content, not a served course payload.)
  const panelHtml = await panel.innerHTML();
  for (const probe of withheldProbes) expect(panelHtml).not.toContain(probe);
  const state = await (await page.request.get(`/api/v1/studies/${rootId}/course`)).json() as unknown;
  const serialized = JSON.stringify(state);
  expect(serialized).not.toContain('"answer"');
  expect(serialized).not.toContain('"rationale"');
  for (const probe of [canonicalAnswer, "The opening of course-0.txt states this directly."]) expect(serialized).not.toContain(probe);
  for (const banned of ['"score"', '"credit"', '"completion"']) expect(serialized).not.toContain(banned);
  // Keyboard-operable recall: focus the field by label, type, Tab to submit.
  await page.getByLabel("Your answer", { exact: true }).click();
  await page.keyboard.type(canonicalAnswer);
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Submit recall answer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Correct.", { exact: false })).toBeVisible();
  await expect(panel.getByText("Canonical answer:", { exact: false })).toBeVisible();
  await expect(panel.getByText(withheldProbes[0])).toBeVisible();
  for (const body of await Promise.all(courseBodies)) for (const probe of withheldProbes) expect(body).not.toContain(probe);
  // B (another learner) cannot open A's course by any verb — no existence leak.
  const stranger = await provisionSynthetic("course-browser-b", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: stranger.email, password: stranger.password } })).status()).toBe(200);
    expect((await client.get(`/api/v1/studies/${rootId}/course`)).status()).toBe(404);
    const denied = await client.post(`/api/v1/studies/${rootId}/course`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 } });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("course-0.txt");
  } finally { await client.dispose(); }
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("generated-course-studied.png"), fullPage: true });
});
