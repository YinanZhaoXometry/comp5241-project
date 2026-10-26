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

async function uploadAndConfirm(page: Page, missing: string, lessons: string[] = ["One generated lesson"]) {
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
