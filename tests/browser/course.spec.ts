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
// The synthetic fixture's per-card canonical answers are the opening
// sentences of the sources the cards draw from (round-robin over the plan's
// outcomes), and each card's source teaches from the remainder AFTER its
// opening sentence — so every card's answer string, every rationale and the
// feedback labels must all stay absent from the page and every GET payload
// until that card's own submission.
const canonicalAnswer = "Synthetic course source one.";
const secondCardAnswer = "Synthetic course source two.";
const withheldProbes = [
  canonicalAnswer,
  secondCardAnswer,
  "The opening of course-0.txt states this directly.",
  "The opening of course-1.txt states this directly.",
  "Canonical answer:",
  "Rationale:",
];

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

// Settle-proof keyboard typing (2026-10-29 hardening of the documented
// practice-typing flake): a sibling re-render landing mid-type can reset the
// controlled input — per-keystroke delay narrows but does not close the
// window, and a gate run caught card 3 submitting the single surviving
// character "S". Type, then VERIFY the input carries the exact text and
// retry (clear + retype) if a re-render ate it; the submission assertions
// are unchanged — this only guarantees the intended text was actually
// entered, exactly what a keyboard user would see and correct on screen.
async function typeVerified(page: Page, label: string, text: string) {
  const field = page.getByLabel(label, { exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await field.focus();
    await page.keyboard.type(text, { delay: 20 });
    if ((await field.inputValue()) === text) return;
    await field.fill("");
  }
  throw new Error(`typing into "${label}" never settled (got: ${JSON.stringify(await field.inputValue())})`);
}

async function grantConsent(page: Page) {
  const configurationVersion = await eligibleConfigurationVersion();
  const decision = await page.request.post("/api/v1/processing/decision", {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, configurationVersion, decision: "granted", acknowledgedTerms: true },
  });
  expect(decision.status()).toBe(200);
}

async function uploadAndConfirm(page: Page, missing: string, lessons: string[] = ["One generated lesson"], outcomes: string[] = ["Recall the first source", "Explain the second source"], files: { name: string; text: string }[] = sources) {
  await page.getByLabel("Synthetic study materials").setInputFiles(files.map(source => ({ name: source.name, mimeType: "text/plain", buffer: Buffer.from(source.text) })));
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const batch = (await (await created).json()) as Receipt;
  for (const source of files) {
    await page.getByRole("button", { name: `Inspect preview · ${source.name}`, exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: `Acknowledge and select ${source.name}`, exact: false });
    await checkbox.waitFor({ state: "visible", timeout: 120000 });
    await checkbox.check();
  }
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic course topic");
  await page.getByLabel("Learning outcomes").fill(outcomes.join("\n"));
  await page.getByLabel("Source coverage / missing explanations", { exact: false }).fill(missing);
  await page.getByLabel("One mini-course title").fill("Course tracer");
  await page.getByLabel("Lessons · one per line").fill(lessons.join("\n"));
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
  const rootId = await uploadAndConfirm(page, "Coverage not assessed. No supplementary sources fetched.");
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Plan confirmed — course not generated.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  // The honest pending state appears, then the server-authoritative ready view.
  await expect(panel.getByText(/Course generating|at most 120 seconds/)).toBeVisible();
  const lesson = panel.getByRole("heading", { name: "1. One generated lesson", exact: true });
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
  // course GET payload carry neither canonical answer (card 1 draws from
  // source one, card 2 from source two — one card per plan outcome), any
  // field, any label nor any rationale. (The Materials preview above
  // legitimately still shows the owner's OWN uploaded sources — the answers'
  // origin — which is owner content, not a served course payload.)
  const panelHtml = await panel.innerHTML();
  for (const probe of withheldProbes) expect(panelHtml).not.toContain(probe);
  const state = await (await page.request.get(`/api/v1/studies/${rootId}/course`)).json() as unknown;
  const serialized = JSON.stringify(state);
  expect(serialized).not.toContain('"answer"');
  expect(serialized).not.toContain('"rationale"');
  for (const probe of [canonicalAnswer, secondCardAnswer, "The opening of course-0.txt states this directly.", "The opening of course-1.txt states this directly."]) expect(serialized).not.toContain(probe);
  for (const banned of ['"score"', '"credit"', '"completion"']) expect(serialized).not.toContain(banned);
  // Epic-2 S5 practice set: one card per plan outcome, both withholding.
  await expect(panel.getByText("Practice set · answers withheld until you submit", { exact: true })).toBeVisible();
  await expect(panel.getByText("Card 1 of 2", { exact: false })).toBeVisible();
  await expect(panel.getByText("Card 2 of 2", { exact: false })).toBeVisible();
  // Keyboard-operable card 1: focus the field by label, type, Tab past the
  // assisted toggle to submit (keyboard-complete run).
  await typeVerified(page, "Your answer to card 1", canonicalAnswer);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Submit card 1 answer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Correct.", { exact: false })).toBeVisible();
  await expect(panel.getByText("Canonical answer:", { exact: false })).toBeVisible();
  await expect(panel.getByText(withheldProbes[0])).toBeVisible();
  await expect(panel.getByText("Evidence kind:", { exact: false })).toBeVisible();
  // Card 2 still withholds its answer after card 1's submission.
  expect(await panel.getByText(secondCardAnswer).count()).toBe(0);
  for (const body of await Promise.all(courseBodies)) for (const probe of withheldProbes) expect(body).not.toContain(probe);
  // Epic-2 S3 player shell: numbered sequence in the sticky sidebar, explicit
  // keyboard mark-done of the required reading, the labeled non-blocking
  // optional enrichment, the media-floor copy and the shared help footer.
  const side = panel.getByRole("complementary");
  await expect(side.getByRole("button", { name: /1\.\s*One generated lesson/ })).toBeVisible();
  await expect(side.getByText("Required", { exact: true })).toBeVisible();
  await expect(side.getByText("Optional — never blocks", { exact: false }).first()).toBeVisible();
  const mark = panel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true });
  await mark.focus();
  await expect(mark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/^Done\./).first()).toBeVisible();
  await expect(panel.getByRole("status", { name: "Content-item tracker status" })).toContainText("Marked done");
  await expect(side.getByText(/Reading done/).first()).toBeVisible();
  // The optional enrichment renders labeled with no mark-done of its own.
  await expect(panel.getByRole("strong").filter({ hasText: "Optional enrichment reading" })).toBeVisible();
  await expect(panel.getByText("Optional — never blocks, never counted, no tracking.", { exact: false })).toBeVisible();
  expect(await panel.getByRole("button", { name: /enrichment/i }).count()).toBe(0);
  await expect(panel.getByText(/Media floor: nothing here autoplays/)).toBeVisible();
  await expect(panel.getByText(/Help — account or recovery: contact the local operator\./)).toBeVisible();
  // Tracker state is server-persisted and carries no dwell/scroll semantics.
  const tracked = await (await page.request.get(`/api/v1/studies/${rootId}/course`)).json() as { course: { items: Array<{ id: string; done: boolean }> } };
  expect(tracked.course.items.find(item => item.id === "lesson:1:reading")?.done).toBe(true);
  expect(tracked.course.items.find(item => item.id === "enrichment:1")?.done).toBe(false);
  for (const banned of ['"dwell"', '"scroll"', '"visibility"', '"timeOnPage"']) expect(JSON.stringify(tracked)).not.toContain(banned);
  // The library line and the plan panel's confirmed heading no longer claim
  // the course is not generated.
  await expect(page.getByText("Plan confirmed · mini-course generated", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Plan confirmed — mini-course generated", exact: true })).toBeVisible();
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

// Epic-2 S2 supplement journey: the plan's declared gaps drive one
// consent-gated check against allowlisted public sources through the bounded
// fetcher (local deterministic fixtures — zero outbound requests). Verified
// passages arrive badged with identity/location/time/hash; a conflict renders
// both sources side by side; an unfindable passage states the honest
// unsupported stop; a fetch that always errors fails honestly with a retry.
test("A checks plan gaps against bounded public sources: badge, side-by-side conflict, unsupported, honest failure", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "course-supplement-a");
  await grantConsent(page);
  const missing = "No source explains mock frameworks. A conflicting statement about doubles and coverage appears in public documentation. One unverifiable claim exists about coverage.";
  const rootId = await uploadAndConfirm(page, missing);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  // The declared gaps list honestly as unaddressed before any check.
  const gapsHeading = panel.getByRole("heading", { name: "Gaps & supplements", exact: true });
  await expect(gapsHeading).toBeVisible();
  await expect(panel.getByText("No source explains mock frameworks.", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("Not checked yet", { exact: false }).first()).toBeVisible();
  // Keyboard run: focus the consent-gated action and submit with Enter.
  const check = panel.getByRole("button", { name: "Check gaps against public sources (AI)", exact: true });
  await check.focus();
  await expect(check).toBeFocused();
  await page.keyboard.press("Enter");
  // Supported: the supplement badge with source identity and retrieval facts.
  await expect(panel.getByText("Supplement — external source", { exact: false }).first()).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(/docs\.example\.org \(https:\/\/docs\.example\.org\//)).toBeVisible();
  await expect(panel.getByText(/content sha256 [0-9a-f]/).first()).toBeVisible();
  await expect(panel.getByText(/retrieved /).first()).toBeVisible();
  // Conflict: both sources shown side by side, never resolved.
  await expect(panel.getByText(/Conflict — both sources shown/).first()).toBeVisible();
  await expect(panel.getByText("Your upload says:", { exact: false })).toBeVisible();
  await expect(panel.getByText("The public source says:", { exact: false })).toBeVisible();
  await expect(panel.getByText(/never resolved silently/)).toBeVisible();
  // Unsupported: the honest stop, no passage shown, nothing added.
  await expect(panel.getByText("Checked, unsupported.", { exact: false })).toBeVisible();
  await expect(panel.getByText(/no supplement content was added/)).toBeVisible();
  // Focus choreography: the completed check moves focus to the section heading.
  await expect(gapsHeading).toBeFocused();
  // GET payload honesty: identity/passage/outcome only — no scored semantics.
  const state = await (await page.request.get(`/api/v1/studies/${rootId}/supplements`)).json() as unknown;
  const serialized = JSON.stringify(state);
  for (const banned of ['"score"', '"credit"', '"completion"', '"attempt"']) expect(serialized).not.toContain(banned);
  expect(serialized).toContain('"supported"');
  expect(serialized).toContain('"conflict"');
  expect(serialized).toContain('"unsupported"');
  // Honest failure: a second study declares a gap whose fixture source always
  // errors at fetch — the whole request fails honestly with a retry action.
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  const failingRoot = await uploadAndConfirm(page, "Sources lack a worked example. An unfetchable page always errors when fetched.");
  const second = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await second.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(second.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await second.getByRole("button", { name: "Check gaps against public sources (AI)", exact: true }).click();
  await expect(second.getByText("Supplement check failed — nothing was saved.", { exact: false })).toBeVisible({ timeout: 60000 });
  await expect(second.getByText(/A proposed source could not be fetched/)).toBeVisible();
  await expect(second.getByRole("button", { name: "Retry supplement check", exact: true })).toBeVisible();
  // No supplement persisted for the failed pass.
  const failed = await (await page.request.get(`/api/v1/studies/${failingRoot}/supplements`)).json() as { state: string };
  expect(failed.state).toBe("failed");
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("supplements-checked.png"), fullPage: true });
});

// Epic-2 S3 player shell journey: a multi-lesson confirmed plan generates the
// full numbered lesson sequence; the sticky sidebar (collapsing under 850px)
// navigates by keyboard with focus choreography onto the lesson heading; the
// content-item tracker persists explicit mark-done per course version; the
// optional enrichment is labeled and never blocks; a re-confirmed plan
// regenerates as a superseding version while the studied version keeps its
// own tracker state until an explicit switch. No dwell/scroll tracking
// anywhere. Synthetic account and content only; the processor is the local
// synthetic fixture — zero outbound requests.
test("player shell: numbered lessons, keyboard mark-done, optional enrichment, superseded version keeps its own tracker", async ({ page }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "course-player-a");
  await grantConsent(page);
  const lessons = ["Player lesson one", "Player lesson two", "Player lesson three"];
  const rootId = await uploadAndConfirm(page, "Coverage not assessed. No supplementary sources fetched.", lessons);
  let panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "1. Player lesson one", exact: true })).toBeVisible({ timeout: 60000 });
  // Numbered lesson sequence in the sidebar; per-lesson required readings.
  const side = panel.getByRole("complementary");
  for (const [index, title] of lessons.entries()) {
    await expect(side.getByRole("button", { name: new RegExp(`${index + 1}\\.\\s*${title}`) })).toBeVisible();
  }
  await expect(side.getByText("Required reading", { exact: true }).first()).toBeVisible();
  // Keyboard lesson navigation: Enter on the nav control moves focus to the
  // lesson heading (focus choreography), all operable at 360px.
  await side.getByRole("button", { name: /2\.\s*Player lesson two/ }).focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "2. Player lesson two", exact: true })).toBeFocused();
  // Explicit keyboard mark-done of lesson 2's required reading: the state is
  // server-persisted for THIS course version and announced politely.
  const mark = panel.getByRole("button", { name: "Mark lesson 2 reading done", exact: true });
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/^Done\./).first()).toBeVisible();
  await expect(panel.getByRole("status", { name: "Content-item tracker status" })).toContainText("Marked done");
  // The optional enrichment shows on the last lesson, labeled, untracked.
  await side.getByRole("button", { name: /3\.\s*Player lesson three/ }).click();
  await expect(panel.getByRole("heading", { name: "3. Player lesson three", exact: true })).toBeFocused();
  await expect(panel.getByRole("strong").filter({ hasText: "Optional enrichment reading" })).toBeVisible();
  await expect(panel.getByText("Optional — never blocks, never counted, no tracking.", { exact: false })).toBeVisible();
  expect(await panel.getByRole("button", { name: /enrichment/i }).count()).toBe(0);
  // Re-confirm a changed plan (the third lesson swaps): the stage remounts
  // honestly — the studied v1 belongs to a previous confirmed plan version and
  // keeps serving (pinned) until an explicit version action.
  await page.getByRole("button", { name: "Edit a new draft revision", exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Player topic, second edition");
  await page.getByLabel("Lessons · one per line").fill("Player lesson one\nPlayer lesson two\nPlayer lesson four");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — mini-course generated", exact: true })).toBeFocused();
  panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await expect(panel.getByText(/previous confirmed plan version/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Generate the current plan's course (AI)", exact: true })).toBeVisible();
  // A regeneration settling elsewhere never silently swaps the studied
  // version: still pinned to v1, an out-of-band generation (as from another
  // client; generation itself bumps no batch revision) settles v2 from the
  // newly confirmed plan, and this view stays put — the next explicit action
  // re-reads the PINNED view and surfaces the superseded state in-shell with
  // the changed required work shown before the switch (D1).
  const studyNow = await (await page.request.get(`/api/v1/studies/${rootId}`)).json() as { revision: number };
  const regen = await page.request.post(`/api/v1/studies/${rootId}/course`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: studyNow.revision } });
  expect(regen.status()).toBe(202);
  await expect.poll(async () => {
    const settled = await (await page.request.get(`/api/v1/studies/${rootId}/course?course=2`)).json() as { state: string };
    return settled.state;
  }, { timeout: 60000 }).toBe("ready");
  // The pinned v1 view is untouched; marking ITS lesson re-reads the pinned
  // selector and reveals the honest superseded notice with the shown diff.
  await panel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true }).click();
  await expect(panel.getByText(/A newer version of this course exists \(version 2/)).toBeVisible();
  await expect(panel.getByText(/Changed required work before you switch to version 2:/)).toBeVisible();
  await expect(panel.getByText(/new lesson “Player lesson four”/)).toBeVisible();
  await expect(panel.getByText(/lesson “Player lesson three” removed/)).toBeVisible();
  // The pinned version keeps its own tracker state through all of this, and
  // the prior-version read path serves it superseded-honest with no dwell,
  // scroll or completion semantics anywhere.
  const pinnedStill = await (await page.request.get(`/api/v1/studies/${rootId}/course?course=1`)).json() as {
    course: { version: number; superseded: boolean; supersededBy: number | null; items: Array<{ id: string; done: boolean }> };
  };
  expect(pinnedStill.course.version).toBe(1);
  expect(pinnedStill.course.superseded).toBe(true);
  expect(pinnedStill.course.supersededBy).toBe(2);
  expect(pinnedStill.course.items.find(item => item.id === "lesson:1:reading")?.done).toBe(true);
  expect(pinnedStill.course.items.find(item => item.id === "lesson:2:reading")?.done).toBe(true);
  for (const banned of ['"dwell"', '"scroll"', '"visibility"', '"timeOnPage"', '"completion"', '"score"']) expect(JSON.stringify(pinnedStill)).not.toContain(banned);
  // The explicit switch moves to version 2 with its own fresh tracker.
  await panel.getByRole("button", { name: "Switch to the current generated version (version 2)", exact: true }).click();
  await expect(panel.getByText(/Version 2 · generated/)).toBeVisible();
  await expect(panel.getByText(/previous confirmed plan version/)).toHaveCount(0);
  await expect(panel.getByText(/^Done\./)).toHaveCount(0);
  // The player stays keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "1. Player lesson one", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("player-shell-studied.png"), fullPage: true });
});

// Epic-2 S4 adaptation journey: the learner's stated background pitches the
// SAME synthetic sources per track through the saved preferences the goal
// stage owns. The beginner pitch line rides the labeled ready view with
// per-section sources and the help footer's report path intact; generation
// and mark-done stay keyboard-complete; a background that was never stated
// (or cannot be classified) claims no track at all. Synthetic account and
// content only; the processor is the local synthetic fixture — zero outbound
// requests.
test("adaptation: stated background pitches the course, neutral claims no track; label, sources and keyboard flows unchanged", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page, "course-adapt-a");
  await grantConsent(page);
  // The saved background the goal stage would save — set through the same
  // preferences API, deterministically.
  const saved = await (await page.request.put("/api/v1/preferences", {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, stage: "goal", goal: null, topic: "", clarification: "", background: "Non-CS, new to programming", timePreference: null, timezone: "" },
  })).json() as { revision: number };
  expect(saved.revision).toBe(1);
  const rootId = await uploadAndConfirm(page, "Coverage not assessed. No supplementary sources fetched.");
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  // Keyboard-complete generation: focus the gated action, submit with Enter.
  const generate = panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true });
  await generate.focus();
  await expect(generate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  // The pitch line states the stored track and its basis honestly; the
  // unreviewed label, per-section sources and the report path stay present.
  await expect(panel.getByText(/Pitched for: a non-CS beginner — plain language, familiar examples, explicit prerequisites/)).toBeVisible();
  await expect(panel.getByText(/from your stated background: “Non-CS, new to programming”/)).toBeVisible();
  await expect(panel.getByText(/every factual claim, lesson and source link is identical across tracks/)).toBeVisible();
  await expect(panel.getByText("AI-generated · Unreviewed", { exact: false })).toBeVisible();
  await expect(panel.getByText("Source: course-0.txt ·", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText(/Help — account or recovery: contact the local operator\./)).toBeVisible();
  // Keyboard mark-done is unchanged by adaptation.
  const mark = panel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true });
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/^Done\./).first()).toBeVisible();
  // The served payload carries the adaptation basis and per-lesson framing,
  // keeps the answer withheld, and carries no scored semantics.
  const adapted = await (await page.request.get(`/api/v1/studies/${rootId}/course`)).json() as {
    course: { adaptation: { track: string; backgroundSummary: string } | null; lessons: Array<{ framing: string | null }> };
  };
  expect(adapted.course.adaptation).toEqual({ track: "beginner", backgroundSummary: "Non-CS, new to programming" });
  expect(adapted.course.lessons[0].framing).toContain("Plain-language");
  for (const banned of [canonicalAnswer, '"answer"', '"rationale"', '"score"', '"credit"', '"completion"']) expect(JSON.stringify(adapted)).not.toContain(banned);
  // A study with no stated background generates neutrally and claims no track.
  const cleared = await page.request.put("/api/v1/preferences", {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: saved.revision, stage: "goal", goal: null, topic: "", clarification: "", background: "", timePreference: null, timezone: "" },
  });
  expect(cleared.status()).toBe(200);
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  const neutralRoot = await uploadAndConfirm(page, "Coverage not assessed. No supplementary sources fetched.");
  const neutralPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await neutralPanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(neutralPanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(neutralPanel.getByText(/Pitched for:/)).toHaveCount(0);
  const neutral = await (await page.request.get(`/api/v1/studies/${neutralRoot}/course`)).json() as {
    course: { adaptation: { track: string; backgroundSummary: string } | null; lessons: Array<{ framing: string | null }> };
  };
  expect(neutral.course.adaptation).toEqual({ track: "neutral", backgroundSummary: "" });
  expect(neutral.course.lessons[0].framing).toContain("no track-specific framing");
  // Overflow-free at 360px and desktop throughout.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("adapted-course-studied.png"), fullPage: true });
});

// Epic-2 S5 practice journey: the plan's outcomes drive a MULTI-CARD practice
// set. Every card runs keyboard-only with attempt-before-answer; feedback
// appears only after that card's own submission and states correctness,
// canonical answer, rationale, source and the evidence kind; the assisted
// toggle declares the evidence at submission (labeled, never conflated with
// unaided); a retry is always a fresh attempt landing fresh typed evidence.
// Synthetic account and content only; the processor is the local synthetic
// fixture — zero outbound requests.
test("practice set: multi-card keyboard-only journey, assisted label, fresh retry", async ({ page, playwright }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const courseBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/course") && response.request().method() === "GET") courseBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  const account = await login(page, "course-practice-a");
  await grantConsent(page);
  const outcomes = ["Recall the first source", "Explain the second source", "Judge the third outcome"];
  const rootId = await uploadAndConfirm(page, "Coverage not assessed. No supplementary sources fetched.", ["One generated lesson"], outcomes);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  // One card per plan objective (three outcomes, two sources: cards 1 and 3
  // draw from source one, card 2 from source two).
  await expect(panel.getByText("Practice set · answers withheld until you submit", { exact: true })).toBeVisible();
  for (const label of ["Card 1 of 3", "Card 2 of 3", "Card 3 of 3"]) await expect(panel.getByText(label, { exact: false })).toBeVisible();
  // Withholding before any submission: no card answer in the panel DOM.
  const panelHtml = await panel.innerHTML();
  for (const probe of withheldProbes) expect(panelHtml).not.toContain(probe);
  // Card 1, keyboard-only, unaided: focus by label → type → Tab past the
  // assisted toggle → Enter on submit.
  await typeVerified(page, "Your answer to card 1", canonicalAnswer);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Submit card 1 answer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Correct.", { exact: false })).toBeVisible();
  await expect(panel.getByText("Canonical answer:", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("Evidence kind:", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Unaided\./).first()).toBeVisible();
  // Card 2, assisted — declared at submission by the keyboard-operable toggle
  // (scoped to card 2's own form): the label states what Assisted means;
  // feedback carries the label.
  const card2 = panel.locator(".practice-card").nth(1);
  const assistedToggle = card2.getByRole("checkbox", { name: /record it as Assisted/ });
  await assistedToggle.focus();
  await page.keyboard.press("Space");
  await expect(assistedToggle).toBeChecked();
  await page.getByLabel("Your answer to card 2", { exact: true }).focus();
  await typeVerified(page, "Your answer to card 2", secondCardAnswer);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Submit card 2 answer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Assisted — declared by you at submission/)).toBeVisible();
  await expect(panel.getByText(secondCardAnswer).first()).toBeVisible(); // revealed for card 2 only
  // Card 3 still withholds: no feedback block, its input still present — then
  // it too runs keyboard-only (its canonical answer is source one's opening,
  // the same sentence card 1 drew).
  const card3 = panel.locator(".practice-card").nth(2);
  await expect(card3.getByRole("textbox")).toBeVisible();
  await expect(card3.getByText("Canonical answer:", { exact: false })).toHaveCount(0);
  await typeVerified(page, "Your answer to card 3", canonicalAnswer);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(card3.getByText("Correct.", { exact: false })).toBeVisible();
  // Retry affordance: try card 2 again — the feedback clears, the form
  // returns, and the next submission is a FRESH attempt (fresh command).
  await panel.getByRole("button", { name: "Try card 2 again (fresh attempt)", exact: true }).click();
  await expect(page.getByLabel("Your answer to card 2", { exact: true })).toBeVisible();
  await page.getByLabel("Your answer to card 2", { exact: true }).fill("A fresh unaided attempt.");
  await panel.getByRole("button", { name: "Submit card 2 answer", exact: true }).click();
  // The resubmitted card's feedback block ALWAYS receives focus — including
  // after a retry, where the focus key is unchanged from the first submission
  // and the retry button the keyboard user was on has unmounted.
  const retriedFeedback = panel.locator(".feedback").filter({ hasText: "Not correct." });
  await expect(retriedFeedback).toBeVisible();
  await expect(retriedFeedback).toBeFocused();
  // Server-side typed evidence: four fresh rows — one per submission event
  // (unaided, assisted, unaided, unaided retry) — never deduplicated, no
  // score columns anywhere.
  const rows = await database().query<{ card_id: string; outcome: string; evidence_kind: string }>(
    "SELECT pa.card_id,pa.outcome,pa.evidence_kind FROM app.practice_attempt pa JOIN app.generated_course c ON c.id=pa.course_id WHERE pa.owner_id=$1 ORDER BY pa.submitted_at,pa.id",
    [account.userId],
  );
  expect(rows.rows.map(row => [row.card_id, row.outcome, row.evidence_kind])).toEqual([
    ["practice:0", "correct", "unaided"],
    ["practice:1", "correct", "assisted"],
    ["practice:2", "correct", "unaided"],
    ["practice:1", "incorrect", "unaided"],
  ]);
  // Every course GET payload across the whole journey stayed answer-free and
  // carried no scored/attempt semantics.
  for (const body of await Promise.all(courseBodies)) {
    for (const probe of withheldProbes) expect(body).not.toContain(probe);
    for (const banned of ['"score"', '"credit"', '"completion"', '"attempt"']) expect(body).not.toContain(banned);
  }
  // B (another learner) cannot submit on A's practice set — no existence leak.
  const stranger = await provisionSynthetic("course-practice-b", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: stranger.email, password: stranger.password } })).status()).toBe(200);
    const denied = await client.post(`/api/v1/studies/${rootId}/course/practice`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, courseId: crypto.randomUUID(), cardId: "practice:0", attempted: "x", assisted: false } });
    expect(denied.status()).toBe(404);
  } finally { await client.dispose(); }
  // Keyboard-complete and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("practice-set-studied.png"), fullPage: true });
});

// Epic-2 S6 why journey: three synthetic sources acknowledged into one lesson
// give the stored evidence that grounds two deeper levels. The whole stepper
// runs keyboard-only — Go deeper twice, the honest exhaustion notice past the
// evidence, the always-visible Stop control collapsing the ladder with focus
// choreography — every level carries its visible sources and the unreviewed
// label, depth unlocks nothing (tracker state untouched), and a depth-past-
// evidence command returns the honest exhaustion verdict with ZERO dispatch.
// A second study covers the exhausted-VERDICT path keyboard-only: a verified
// supplement grows the evidence, the pass then stops being settled out-of-
// band, and dispatching the stale offer announces the stop with focus on the
// notice instead of unmounting the focused button into silence.
// Synthetic account and content only; the processor is the local synthetic
// fixture — zero outbound requests.
test("why explorer: keyboard-only deeper ×2, exhaustion notice, stop control, unreviewed label; depth unlocks nothing", async ({ page }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  const account = await login(page, "course-why-a");
  await grantConsent(page);
  const whySources = [
    { name: "why-0.txt", text: "Why source zero opens the reading. Its remainder explains arrangement." },
    { name: "why-1.txt", text: "Why source one adds conditions. The second piece carries assumptions." },
    { name: "why-2.txt", text: "Why source two rounds the set out. A third piece grounds trade-offs." },
  ];
  const rootId = await uploadAndConfirm(page, "Coverage not assessed. No supplementary sources fetched.", ["One generated lesson"], ["Recall the first why source", "Explain the second why source"], whySources);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  // The why explorer renders beside the lesson with the honest floor copy and
  // the first level offered (the stepper never offers an ungrounded level).
  const whyHeading = panel.getByRole("heading", { name: "Why-explorer", exact: true });
  await expect(whyHeading).toBeVisible();
  await expect(panel.getByText(/Depth unlocks nothing/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Go deeper (depth 1: Purpose)", exact: true })).toBeVisible();
  expect(await panel.getByRole("button", { name: /Go deeper \(depth 2/ }).count()).toBe(0);
  // Keyboard run, level 1: focus the consent-gated action, submit with Enter.
  const deeper1 = panel.getByRole("button", { name: "Go deeper (depth 1: Purpose)", exact: true });
  await deeper1.focus();
  await expect(deeper1).toBeFocused();
  await page.keyboard.press("Enter");
  const level1 = panel.locator("#why-level-1");
  await expect(level1).toBeVisible({ timeout: 60000 });
  // Focus choreography: the settled level block receives focus.
  await expect(level1).toBeFocused();
  await expect(level1.getByText(/AI-generated · Unreviewed/)).toBeVisible();
  await expect(level1.getByText(/Depth 1 · Purpose/)).toBeVisible();
  // Each level cites its visible sources (lesson source lines with locators).
  await expect(level1.getByText(/Lesson source: why-0\.txt ·/).first()).toBeVisible();
  await expect(level1.getByText(/Lesson source: why-1\.txt ·/).first()).toBeVisible();
  await expect(level1.getByText(/this depth unlocked nothing\./)).toBeVisible();
  // Keyboard run, level 2: a distinct dimension with its own prose and sources.
  const deeper2 = panel.getByRole("button", { name: "Go deeper (depth 2: Assumptions & trade-offs)", exact: true });
  await deeper2.focus();
  await page.keyboard.press("Enter");
  const level2 = panel.locator("#why-level-2");
  await expect(level2).toBeVisible({ timeout: 60000 });
  await expect(level2).toBeFocused();
  await expect(level2.getByText(/Depth 2 · Assumptions & trade-offs/)).toBeVisible();
  await expect(level2.getByText(/AI-generated · Unreviewed/)).toBeVisible();
  expect((await level1.textContent()) !== (await level2.textContent())).toBe(true);
  // The stored evidence is exhausted past level 2: the notice states it and
  // the stepper stops — no third Go deeper action is ever offered.
  await expect(panel.getByText("The sources here are exhausted for this question.", { exact: false })).toBeVisible();
  expect(await panel.getByRole("button", { name: /Go deeper/ }).count()).toBe(0);
  // The stop control is visible at every depth and keyboard-operable: it
  // collapses the stepper and focus moves to the why heading.
  const stop = panel.getByRole("button", { name: "Stop exploring", exact: true });
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(whyHeading).toBeFocused();
  await expect(panel.locator("#why-level-1")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Show why exploration", exact: true })).toBeVisible();
  // Reopening restores the ladder exactly as settled.
  await panel.getByRole("button", { name: "Show why exploration", exact: true }).click();
  await expect(panel.locator("#why-level-1")).toBeVisible();
  await expect(panel.locator("#why-level-2")).toBeVisible();
  // A request past the available evidence (out of band, as a stale client
  // would send): the honest exhaustion verdict with 200, and ZERO dispatch —
  // no third row ever lands in the database.
  const course = await (await page.request.get(`/api/v1/studies/${rootId}/course`)).json() as { course: { courseId: string; items: Array<{ done: boolean }> } };
  const studyNow = await (await page.request.get(`/api/v1/studies/${rootId}`)).json() as { revision: number };
  const past = await page.request.post(`/api/v1/studies/${rootId}/course/why`, {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: studyNow.revision, courseId: course.course.courseId, lessonIndex: 0, depth: 3 },
  });
  expect(past.status()).toBe(200);
  expect(await past.json()).toMatchObject({ state: "exhausted", depth: 3, availableDepth: 2 });
  // Depth unlocked nothing: exactly the two settled rows, no tracker state,
  // no done items, and no scored semantics in the served why state.
  const rows = await database().query<{ depth: number; status: string }>(
    "SELECT w.depth,w.status FROM app.why_explanation w JOIN app.generated_course c ON c.id=w.course_id WHERE w.owner_id=$1 AND c.root_id=$2 ORDER BY w.depth",
    [account.userId, rootId],
  );
  expect(rows.rows).toEqual([{ depth: 1, status: "ready" }, { depth: 2, status: "ready" }]);
  expect(course.course.items.every(item => !item.done)).toBe(true);
  expect((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.course_item_state WHERE owner_id=$1", [account.userId])).rows[0].count).toBe(0);
  const servedWhy = await (await page.request.get(`/api/v1/studies/${rootId}/course/why?course=${course.course.courseId}&lesson=0`)).json() as unknown;
  for (const banned of ['"score"', '"credit"', '"completion"', '"unlock"', '"attempt"']) expect(JSON.stringify(servedWhy)).not.toContain(banned);
  // Exhausted-verdict path, keyboard-only, on a second study: a verified
  // supplement grows the evidence to depth 2, level 1 settles, then the
  // supplement pass is staged out-of-band as no longer settled — server-side
  // availability shrinks back to depth 1 while this view's ladder still
  // offers depth 2. Dispatching the stale offer returns the honest exhaustion
  // verdict with ZERO dispatch: the focused button unmounts and focus lands
  // on the notice (the stop is announced, never silent), and no depth-2 row
  // ever lands.
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  const shrinkRoot = await uploadAndConfirm(page, "No source explains mock frameworks.", ["One generated lesson"]);
  const shrinkPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await shrinkPanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(shrinkPanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  // The keyboard supplement check verifies the plan's one gap (supported) —
  // the stored evidence now grounds depth 2.
  const check = shrinkPanel.getByRole("button", { name: "Check gaps against public sources (AI)", exact: true });
  await check.focus();
  await page.keyboard.press("Enter");
  await expect(shrinkPanel.getByText("Supplement — external source", { exact: false }).first()).toBeVisible({ timeout: 60000 });
  // Keyboard level 1; its settle re-read carries the grown availability, so
  // the ladder then offers depth 2.
  const shrinkDeeper1 = shrinkPanel.getByRole("button", { name: "Go deeper (depth 1: Purpose)", exact: true });
  await shrinkDeeper1.focus();
  await page.keyboard.press("Enter");
  await expect(shrinkPanel.locator("#why-level-1")).toBeVisible({ timeout: 60000 });
  const shrinkDeeper2 = shrinkPanel.getByRole("button", { name: "Go deeper (depth 2: Assumptions & trade-offs)", exact: true });
  await expect(shrinkDeeper2).toBeVisible();
  // Stage the shrink: the latest supplement pass is no longer settled, so the
  // verified pool is empty and only depth 1 is groundable server-side.
  const shrinkCourse = await (await page.request.get(`/api/v1/studies/${shrinkRoot}/course`)).json() as { course: { courseId: string } };
  await database().query("UPDATE app.supplement_request SET status='failed', failure_code='timeout', settled_at=clock_timestamp() WHERE course_id=$1 AND status='ready'", [shrinkCourse.course.courseId]);
  // Keyboard dispatch of the stale offer: the honest verdict returns, the
  // notice renders and RECEIVES FOCUS, the offer disappears, and nothing was
  // dispatched or stored for depth 2.
  await shrinkDeeper2.focus();
  await page.keyboard.press("Enter");
  const shrinkNotice = shrinkPanel.locator("#why-exhausted-notice");
  await expect(shrinkNotice).toBeVisible();
  await expect(shrinkNotice).toBeFocused();
  await expect(shrinkNotice).toContainText("The sources here are exhausted for this question.");
  expect(await shrinkPanel.getByRole("button", { name: /Go deeper/ }).count()).toBe(0);
  expect(await shrinkPanel.locator("#why-level-2").count()).toBe(0);
  const shrinkRows = await database().query<{ depth: number }>(
    "SELECT w.depth FROM app.why_explanation w WHERE w.owner_id=$1 AND w.course_id=$2 ORDER BY w.depth",
    [account.userId, shrinkCourse.course.courseId],
  );
  expect(shrinkRows.rows).toEqual([{ depth: 1 }]);
  // Keyboard-complete and overflow-free at 360px and desktop throughout.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("why-explorer-studied.png"), fullPage: true });
});
