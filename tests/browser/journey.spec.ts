import { test, expect, type Page } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import type { Receipt } from "../../src/contracts/setup";

// Epic-2 S10 integrated study suite (the closable LOCAL half): ONE journey per
// Done-when clause composing every prior entry's proven behaviors against the
// real UI, plus the denied/error/accessibility set. Track A (non-CS beginner,
// 360px, keyboard-only) runs material → confirmed plan → generated course →
// adapted study → attributed supplementation (badge, side-by-side conflict,
// unsupported stop) → why depth ×2 with honest exhaustion and stop → recall
// withholding and typed feedback → tracker → provenance pinning → export
// including the three owner classes → root deletion purging every derivative
// class. Track B (CS graduate, desktop, keyboard) generates the SAME objective
// from the SAME sources and carries the cross-track proof through the stored
// factsDigest, then runs the cross-owner no-leak denial sweep across every
// verb. The LIVE halves (F-A live processor, F-B live fetch, F-C deployment)
// are NOT attempted here and stay unadmitted — no release claim is made.
// Synthetic accounts and content only; the processor is the local synthetic
// fixture and the fetcher the local fixture port — zero outbound requests.
const origin = "http://127.0.0.1:3000";
// Three sources acknowledged into one lesson carry the stored evidence that
// grounds why depth 2; their opening sentences are the practice cards'
// canonical answers (round-robin over the plan's two outcomes).
const journeySources = [
  { name: "journey-0.txt", text: "Synthetic journey source zero. The remainder explains arrangement for the integrated journey." },
  { name: "journey-1.txt", text: "Synthetic journey source one. Doubles and coverage documentation carries assumptions for the journey." },
  { name: "journey-2.txt", text: "Synthetic journey source two. A third piece grounds trade-offs for the journey." },
];
const canonicalAnswerA = "Synthetic journey source zero.";
const canonicalAnswerB = "Synthetic journey source one.";
const withheldProbes = [
  canonicalAnswerA,
  canonicalAnswerB,
  "Canonical answer:",
  "Rationale:",
  "The opening of journey-0.txt states this directly.",
  "The opening of journey-1.txt states this directly.",
];
// The S2 gap markers: supported, conflict and unsupported fixtures.
const gapMissing = "No source explains mock frameworks. A conflicting statement about doubles and coverage appears in public documentation. One unverifiable claim exists about coverage.";
const journeyOutcomes = ["Recall the first journey source", "Explain the second journey source"];

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

// The processor_configuration table is shared, ordered state: sibling specs can
// leave the current version ineligible. Pin a clearly-labeled eligible fixture
// ONLY then — on a fresh database the journey grants under the honest
// disclosure the migration inserted (mirrors course.spec's helper).
async function eligibleConfigurationVersion() {
  const max = await database().query<{ version: number; eligibility: string }>("SELECT version, eligibility FROM app.processor_configuration ORDER BY version DESC LIMIT 1");
  if (max.rows[0]?.eligibility === "eligible") return max.rows[0].version;
  const version = max.rows[0] ? max.rows[0].version + 1 : 1;
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

// The goal stage's saved background, set through the same preferences API the
// stage owns (the S4 pattern) — the adaptation basis pinned at request time.
async function stateBackground(page: Page, background: string) {
  const saved = await page.request.put("/api/v1/preferences", {
    headers: { Origin: origin },
    data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, stage: "goal", goal: null, topic: "", clarification: "", background, timePreference: null, timezone: "" },
  });
  expect(saved.status()).toBe(200);
}

async function uploadAndConfirm(page: Page, missing: string, files: { name: string; text: string }[], outcomes: string[] = journeyOutcomes) {
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
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic journey topic");
  await page.getByLabel("Learning outcomes").fill(outcomes.join("\n"));
  await page.getByLabel("Source coverage / missing explanations", { exact: false }).fill(missing);
  await page.getByLabel("One mini-course title").fill("Journey tracer");
  await page.getByLabel("Lessons · one per line").fill("One generated lesson");
  await page.getByLabel("Practice activity").fill("Submit one recall item");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  return batch.rootId;
}

// Synthetic tar decoder (mirrors the integration suite's): name -> content.
function decodeArtifact(input: Buffer) {
  if (input[0] !== 0x1f || input[1] !== 0x8b) throw new Error("Artifact is not gzip");
  const tar = new Uint8Array(gunzipSync(input));
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset < tar.length) {
    const block = tar.subarray(offset, offset + 512);
    offset += 512;
    if (block.every(byte => byte === 0)) break;
    const name = new TextDecoder().decode(block.subarray(0, 100)).replace(/\0.*$/u, "");
    const size = parseInt(new TextDecoder().decode(block.subarray(124, 136)).replace(/\0.*/u, "").trim(), 8);
    entries.set(name, tar.subarray(offset, offset + size));
    offset += size + ((512 - (size % 512)) % 512);
  }
  return entries;
}

test("integrated journey: both tracks study identical facts through generation, supplements, why, practice, provenance, export and deletion", async ({ page, browser }, info) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });

  // ---- Track A: non-CS beginner, one full lifecycle, keyboard-only at 360px.
  const ownerA = await login(page, "journey-a");
  await grantConsent(page);
  await stateBackground(page, "Non-CS, new to programming");
  const rootA = await uploadAndConfirm(page, gapMissing, journeySources);
  let panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  // Keyboard-complete generation: focus the gated action, submit with Enter;
  // the honest pending state shows first, then the server-authoritative view.
  const generate = panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true });
  await generate.focus();
  await expect(generate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Course generating|at most 120 seconds/)).toBeVisible();
  await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByRole("heading", { name: "Your mini-course", exact: true })).toBeFocused();
  // Honesty label, version line, per-section sources and the beginner pitch.
  await expect(panel.getByText("AI-generated · Unreviewed", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Version 1 · generated/)).toBeVisible();
  for (const source of journeySources) await expect(panel.getByText(`Source: ${source.name} ·`, { exact: false }).first()).toBeVisible();
  await expect(panel.getByText(/Pitched for: a non-CS beginner — plain language, familiar examples, explicit prerequisites/)).toBeVisible();
  await expect(panel.getByText(/from your stated background: “Non-CS, new to programming”/)).toBeVisible();
  await expect(panel.getByText(/every factual claim, lesson and source link is identical across tracks/)).toBeVisible();
  // Recall withholding before any submission: panel DOM and course GET payload
  // carry no canonical answer, rationale or scored semantics.
  const panelHtml = await panel.innerHTML();
  for (const probe of withheldProbes) expect(panelHtml).not.toContain(probe);
  const courseView = await (await page.request.get(`/api/v1/studies/${rootA}/course`)).json() as {
    course: { courseId: string; factsDigest: string; adaptation: { track: string; backgroundSummary: string } };
  };
  expect(courseView.course.adaptation).toEqual({ track: "beginner", backgroundSummary: "Non-CS, new to programming" });
  expect(courseView.course.factsDigest).toMatch(/^[0-9a-f]{64}$/u);
  const digestA = courseView.course.factsDigest;
  const courseIdA = courseView.course.courseId;
  for (const banned of ['"answer"', '"rationale"', '"score"', '"credit"', '"completion"']) expect(JSON.stringify(courseView)).not.toContain(banned);
  // Provenance pinning: the consumer snapshots the pinned document BEFORE any
  // derivative exists; the immutable block must stay byte-identical while the
  // version's own derivatives grow below.
  const pinnedBefore = await (await page.request.get(`/api/v1/studies/${rootA}/provenance?course=${courseIdA}`)).json() as {
    state: string; provenance: { immutable: unknown; derivatives: { supplements: unknown[]; whyExplanations: unknown[] } };
  };
  expect(pinnedBefore.state).toBe("ready");
  expect(pinnedBefore.provenance.derivatives.supplements).toHaveLength(0);
  expect(pinnedBefore.provenance.derivatives.whyExplanations).toHaveLength(0);
  const pinnedImmutableBefore = JSON.stringify(pinnedBefore.provenance.immutable);

  // Attributed supplementation, keyboard-only: the declared gaps drive one
  // consent-gated check through the local fixture fetcher — badge with source
  // identity/location/hash/time, a side-by-side conflict, an unsupported stop.
  const check = panel.getByRole("button", { name: "Check gaps against public sources (AI)", exact: true });
  await check.focus();
  await expect(check).toBeFocused();
  await page.keyboard.press("Enter");
  const gapsHeading = panel.getByRole("heading", { name: "Gaps & supplements", exact: true });
  await expect(panel.getByText("Supplement — external source", { exact: false }).first()).toBeVisible({ timeout: 60000 });
  // Accessibility floor on the READY view (the densest layout): no page-level
  // horizontal overflow at both widths — the library-level check at the end
  // alone would miss the supplements/why/practice sections.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("heading", { name: "Your mini-course", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(panel.getByText(/docs\.example\.org \(https:\/\/docs\.example\.org\//)).toBeVisible();
  await expect(panel.getByText(/content sha256 [0-9a-f]/).first()).toBeVisible();
  await expect(panel.getByText(/retrieved /).first()).toBeVisible();
  await expect(panel.getByText(/Conflict — both sources shown/).first()).toBeVisible();
  await expect(panel.getByText("Your upload says:", { exact: false })).toBeVisible();
  await expect(panel.getByText("The public source says:", { exact: false })).toBeVisible();
  await expect(panel.getByText("Checked, unsupported.", { exact: false })).toBeVisible();
  await expect(panel.getByText(/no supplement content was added/)).toBeVisible();
  await expect(gapsHeading).toBeFocused();
  const supplementsState = await (await page.request.get(`/api/v1/studies/${rootA}/supplements`)).json() as unknown;
  const supplementsSerialized = JSON.stringify(supplementsState);
  for (const outcome of ['"supported"', '"conflict"', '"unsupported"']) expect(supplementsSerialized).toContain(outcome);
  for (const banned of ['"score"', '"credit"', '"completion"', '"attempt"']) expect(supplementsSerialized).not.toContain(banned);

  // Why exploration, keyboard-only: two successive non-restatement levels with
  // visible sources, the honest exhaustion notice past the stored evidence,
  // the always-visible stop control with focus choreography — depth unlocks
  // nothing.
  const deeper1 = panel.getByRole("button", { name: "Go deeper (depth 1: Purpose)", exact: true });
  await deeper1.focus();
  await page.keyboard.press("Enter");
  const level1 = panel.locator("#why-level-1");
  await expect(level1).toBeVisible({ timeout: 60000 });
  await expect(level1).toBeFocused();
  await expect(level1.getByText(/Depth 1 · Purpose/)).toBeVisible();
  await expect(level1.getByText(/AI-generated · Unreviewed/)).toBeVisible();
  await expect(level1.getByText(/Lesson source: journey-0\.txt ·/).first()).toBeVisible();
  await expect(level1.getByText(/this depth unlocked nothing\./)).toBeVisible();
  const deeper2 = panel.getByRole("button", { name: "Go deeper (depth 2: Assumptions & trade-offs)", exact: true });
  await deeper2.focus();
  await page.keyboard.press("Enter");
  const level2 = panel.locator("#why-level-2");
  await expect(level2).toBeVisible({ timeout: 60000 });
  await expect(level2).toBeFocused();
  await expect(level2.getByText(/Depth 2 · Assumptions & trade-offs/)).toBeVisible();
  expect((await level1.textContent()) !== (await level2.textContent())).toBe(true);
  await expect(panel.getByText("The sources here are exhausted for this question.", { exact: false })).toBeVisible();
  expect(await panel.getByRole("button", { name: /Go deeper/ }).count()).toBe(0);
  const stop = panel.getByRole("button", { name: "Stop exploring", exact: true });
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "Why-explorer", exact: true })).toBeFocused();
  await expect(panel.locator("#why-level-1")).toHaveCount(0);

  // Recall practice, keyboard-only: card 1 unaided, card 2 with the assisted
  // toggle declaring the evidence at submission — feedback only after each
  // card's own submission, typed evidence server-side.
  await expect(panel.getByText("Practice set · answers withheld until you submit", { exact: true })).toBeVisible();
  await page.getByLabel("Your answer to card 1", { exact: true }).focus();
  await page.keyboard.type(canonicalAnswerA);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Submit card 1 answer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Correct.", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("Canonical answer:", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("Evidence kind:", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText(/Unaided\./).first()).toBeVisible();
  const card2 = panel.locator(".practice-card").nth(1);
  const assistedToggle = card2.getByRole("checkbox", { name: /record it as Assisted/ });
  await assistedToggle.focus();
  await page.keyboard.press("Space");
  await expect(assistedToggle).toBeChecked();
  await page.getByLabel("Your answer to card 2", { exact: true }).focus();
  await page.keyboard.type(canonicalAnswerB);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Submit card 2 answer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Assisted — declared by you at submission/)).toBeVisible();
  const practiceRows = await database().query<{ card_id: string; outcome: string; evidence_kind: string }>(
    "SELECT pa.card_id,pa.outcome,pa.evidence_kind FROM app.practice_attempt pa WHERE pa.owner_id=$1 ORDER BY pa.submitted_at,pa.id",
    [ownerA.userId],
  );
  expect(practiceRows.rows.map(row => [row.card_id, row.outcome, row.evidence_kind])).toEqual([
    ["practice:0", "correct", "unaided"],
    ["practice:1", "correct", "assisted"],
  ]);

  // Content-item tracker, keyboard-only: explicit mark-done of the required
  // reading, announced politely, no dwell/scroll semantics anywhere.
  const mark = panel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true });
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/^Done\./).first()).toBeVisible();
  await expect(panel.getByRole("status", { name: "Content-item tracker status" })).toContainText("Marked done");
  await expect(panel.getByRole("complementary").getByText(/Reading done/).first()).toBeVisible();

  // Provenance pin holds across the derivative growth: the pinned immutable
  // block is byte-identical and the derivatives only gained entries.
  const pinnedAfter = await (await page.request.get(`/api/v1/studies/${rootA}/provenance?course=${courseIdA}`)).json() as {
    provenance: { immutable: unknown; derivatives: { supplements: Array<{ outcome: string }>; whyExplanations: unknown[] } };
  };
  expect(JSON.stringify(pinnedAfter.provenance.immutable)).toBe(pinnedImmutableBefore);
  expect(pinnedAfter.provenance.derivatives.supplements.map(supplement => supplement.outcome)).toEqual(["supported", "conflict", "unsupported"]);
  expect(pinnedAfter.provenance.derivatives.whyExplanations).toHaveLength(2);

  // Export through the real panel: honest scope first (the three owner classes
  // counted, supplements as the one deliberate class skip), then the ready
  // authenticated download decoded to assert the artifact's real contents.
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  const exportPanel = page.getByRole("region", { name: "Export your setup data" });
  await expect(exportPanel.getByText("Generated mini-courses: 1", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(exportPanel.getByText("Practice evidence: 2", { exact: true })).toBeVisible();
  await expect(exportPanel.getByText("AI why explanations: 2", { exact: true })).toBeVisible();
  await expect(exportPanel.getByText("Verified source supplements: Present; deliberately excluded from the artifact — see the manifest skip note", { exact: true })).toBeVisible();
  const requestExport = exportPanel.getByRole("button", { name: "Request export snapshot" });
  await requestExport.focus();
  await expect(requestExport).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(exportPanel.getByText("Ready for authenticated download.", { exact: false })).toBeVisible({ timeout: 60000 });
  const exportPreview = await (await page.request.get("/api/v1/exports")).json() as { requests: Array<{ id: string; state: string }> };
  expect(exportPreview.requests[0]?.state).toBe("ready");
  const downloadResponse = await page.request.get(`/api/v1/exports/${exportPreview.requests[0].id}/download`);
  expect(downloadResponse.status()).toBe(200);
  const artifact = Buffer.from(await downloadResponse.body());
  expect(artifact[0]).toBe(0x1f);
  expect(artifact[1]).toBe(0x8b);
  const entries = decodeArtifact(artifact);
  const coursePayload = JSON.parse(new TextDecoder().decode(entries.get(`courses/${courseIdA}.json`)!)) as {
    row: { content: { practice?: { cards?: Array<{ answer: string }> } } };
    objectives: unknown[];
    sources: unknown[];
    supplementReferences: Array<Record<string, unknown>>;
  };
  expect(coursePayload.objectives.length).toBeGreaterThan(0);
  expect(coursePayload.sources.length).toBeGreaterThan(0);
  expect((coursePayload.row.content.practice?.cards ?? []).map(card => card.answer)).toContain(canonicalAnswerA);
  expect(coursePayload.supplementReferences).toHaveLength(3);
  const practicePayload = JSON.parse(new TextDecoder().decode(entries.get("practice/practice-evidence.json")!)) as { rows: Array<{ attempted: string; evidence_kind: string }> };
  expect(practicePayload.rows.map(row => row.evidence_kind).sort()).toEqual(["assisted", "unaided"]);
  for (const answer of [canonicalAnswerA, canonicalAnswerB]) expect(practicePayload.rows.some(row => row.attempted === answer)).toBe(true);
  const whyPayload = JSON.parse(new TextDecoder().decode(entries.get("why/why-explanations.json")!)) as { rows: Array<{ explanation: string | null; status: string; depth: number }> };
  expect(whyPayload.rows.filter(row => row.status === "ready").map(row => row.depth).sort()).toEqual([1, 2]);
  expect(whyPayload.rows.every(row => typeof row.explanation === "string" && row.explanation.length > 0)).toBe(true);
  // Fetched supplement passages never enter the artifact (the one class skip).
  const artifactText = new TextDecoder().decode(gunzipSync(artifact));
  expect(artifactText).not.toContain("not the case");

  // ---- Track B: CS graduate on desktop — same sources, same objective, the
  // cross-track proof through the stored factsDigest.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const errorsB: string[] = [];
  const outboundB: string[] = [];
  pageB.on("pageerror", error => errorsB.push(error.name));
  pageB.on("request", request => { if (!request.url().startsWith(origin)) outboundB.push(new URL(request.url()).hostname); });
  try {
    await pageB.setViewportSize({ width: 1280, height: 900 });
    const ownerB = await login(pageB, "journey-b");
    await grantConsent(pageB);
    await stateBackground(pageB, "CS graduate, interview prep");
    const rootB = await uploadAndConfirm(pageB, "Coverage not assessed. No supplementary sources fetched.", journeySources);
    const panelB = pageB.locator("section").filter({ has: pageB.getByRole("heading", { name: "Your mini-course", exact: true }) });
    const generateB = panelB.getByRole("button", { name: "Generate mini-course (AI)", exact: true });
    await generateB.focus();
    await expect(generateB).toBeFocused();
    await pageB.keyboard.press("Enter");
    await expect(panelB.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
    await expect(panelB.getByText(/Pitched for: an experienced-developer level — application scenarios and trade-off depth/)).toBeVisible();
    await expect(panelB.getByText(/from your stated background: “CS graduate, interview prep”/)).toBeVisible();
    await expect(panelB.getByText("AI-generated · Unreviewed", { exact: false })).toBeVisible();
    for (const source of journeySources) await expect(panelB.getByText(`Source: ${source.name} ·`, { exact: false }).first()).toBeVisible();
    const courseViewB = await (await pageB.request.get(`/api/v1/studies/${rootB}/course`)).json() as {
      course: { courseId: string; factsDigest: string; adaptation: { track: string; backgroundSummary: string }; lessons: Array<{ framing: string | null }> };
    };
    expect(courseViewB.course.adaptation).toEqual({ track: "advanced", backgroundSummary: "CS graduate, interview prep" });
    // IDENTICAL FACTS ACROSS TRACKS: the stored digest of the factual core
    // (treatment excluded) is the same 64-hex string as track A's.
    expect(courseViewB.course.factsDigest).toBe(digestA);
    expect(courseViewB.course.lessons[0].framing).not.toContain("no track-specific framing");

    // Cross-owner no-leak denial set: B hits every verb of A's LIVE study —
    // every read and every command denies identically, nothing of A's content
    // travels, and B's own ledger shows only B's single generation dispatch.
    const envelope = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
    const denials: Array<() => Promise<void>> = [
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}`)).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/material`)).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/handoff`)).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/course`)).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/course`, { headers: { Origin: origin }, data: envelope })).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/supplements`)).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/supplements`, { headers: { Origin: origin }, data: { ...envelope, courseId: courseIdA } })).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/course/why?course=${courseIdA}&lesson=0`)).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/course/why`, { headers: { Origin: origin }, data: { ...envelope, courseId: courseIdA, lessonIndex: 0, depth: 1 } })).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/course/practice`, { headers: { Origin: origin }, data: { ...envelope, courseId: courseIdA, cardId: "practice:0", attempted: "x", assisted: false } })).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/course/track`, { headers: { Origin: origin }, data: { ...envelope, courseId: courseIdA, itemId: "lesson:1:reading" } })).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/provenance`)).status()).toBe(404); },
      async () => { expect((await pageB.request.get(`/api/v1/studies/${rootA}/provenance?course=${courseIdA}`)).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/ai-draft`, { headers: { Origin: origin }, data: envelope })).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/dependencies`, { headers: { Origin: origin }, data: { schemaVersion: 1 } })).status()).toBe(404); },
      async () => { expect((await pageB.request.post(`/api/v1/studies/${rootA}/removal`, { headers: { Origin: origin }, data: envelope })).status()).toBe(404); },
    ];
    for (const deny of denials) await deny();
    // No-leak: A's source names and canonical answers never travel in a body.
    const deniedBody = await pageB.request.get(`/api/v1/studies/${rootA}/course`);
    expect(await deniedBody.text()).not.toContain("journey-0.txt");
    expect(await deniedBody.text()).not.toContain(canonicalAnswerA);
    const ledgerB = await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1", [ownerB.userId]);
    expect(ledgerB.rows[0].count).toBe(1); // only B's own generation — the sweep dispatched nothing
    await pageB.screenshot({ path: info.outputPath("integrated-journey-advanced.png"), fullPage: true });
  } finally {
    await contextB.close();
  }

  // ---- Track A closes the lifecycle: root deletion after full usage purges
  // every derivative class; the scope preview was honest beforehand (above).
  await page.getByRole("button", { name: "View plan", exact: true }).click();
  panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  const review = page.getByRole("button", { name: "Review removal", exact: true });
  await review.focus();
  await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Generated mini-courses: 1", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Verified source supplements: 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Study tracker state: 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Practice evidence: 2", { exact: true }).first()).toBeVisible(); // export panel and deletion preview both count it
  await expect(page.getByText("AI why explanations: 2", { exact: true }).first()).toBeVisible(); // both panels count it
  // Cancel is the safe default and returns focus to the opener.
  const cancel = page.getByRole("button", { name: "Cancel removal", exact: true });
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(review).toBeFocused();
  await review.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Generated mini-courses: 1", { exact: true })).toBeVisible();
  const confirmRemoval = page.getByRole("button", { name: "Delete material and dependent plans", exact: true });
  await confirmRemoval.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Access revoked\. Active-copy cleanup is pending or complete/)).toBeVisible();
  await expect(page.getByText(/Access revoked · cleanup/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  // Post-deletion reads deny on default and pinned selectors — no resurrection.
  for (const path of [`/api/v1/studies/${rootA}`, `/api/v1/studies/${rootA}/course`, `/api/v1/studies/${rootA}/course?course=${courseIdA}`, `/api/v1/studies/${rootA}/supplements`, `/api/v1/studies/${rootA}/provenance`, `/api/v1/studies/${rootA}/provenance?course=${courseIdA}`]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
  expect((await page.request.get(`/api/v1/studies/${rootA}/course/why?course=${courseIdA}&lesson=0`)).status()).toBe(404);
  // Every derivative class is purged for the root (course lineage, objectives,
  // sources, supplements, supplement passes, why, practice, tracker state).
  for (const [label, query, parameter] of [
    ["generated_course", "SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1", rootA],
    ["course_objective", "SELECT count(*)::int AS count FROM app.course_objective WHERE course_id=$1", courseIdA],
    ["course_source", "SELECT count(*)::int AS count FROM app.course_source WHERE course_id=$1", courseIdA],
    ["course_supplement", "SELECT count(*)::int AS count FROM app.course_supplement WHERE course_id=$1", courseIdA],
    ["supplement_request", "SELECT count(*)::int AS count FROM app.supplement_request WHERE root_id=$1", rootA],
    ["why_explanation", "SELECT count(*)::int AS count FROM app.why_explanation WHERE course_id=$1", courseIdA],
    ["practice_attempt", "SELECT count(*)::int AS count FROM app.practice_attempt WHERE course_id=$1", courseIdA],
    ["course_item_state", "SELECT count(*)::int AS count FROM app.course_item_state WHERE course_id=$1", courseIdA],
  ] as const) {
    const rows = await database().query<{ count: number }>(query, [parameter]);
    expect(rows.rows[0].count, label).toBe(0);
  }
  // Keyboard-complete and overflow-free at 360px AND desktop on both tracks.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  expect(outboundB).toEqual([]);
  expect(errorsB).toEqual([]);
  await page.screenshot({ path: info.outputPath("integrated-journey-deleted.png"), fullPage: true });
});

// The denied/error companion set: consent-denied degradation (manual study
// standing, zero dispatch), unconfirmed and stale-command denials with zero
// persisted effect, and the honest retryable generation failure state.
test("denied and error set: consent denial keeps manual study standing; unconfirmed, stale and invalid commands deny with zero effect; supplement failure is honest", async ({ page }, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  const owner = await login(page, "journey-denied");
  // NO processing consent granted: the full manual path stands (upload →
  // preview → acknowledge → save → confirm) and the AI action is honestly
  // unavailable — disabled with the honest reason, not hidden.
  const failingMissing = "Sources lack a worked example. An unfetchable page always errors when fetched.";
  const rootId = await uploadAndConfirm(page, failingMissing, journeySources.slice(0, 2));
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  const generate = panel.getByRole("button", { name: "Generate mini-course (AI)", exact: true });
  await expect(generate).toBeDisabled();
  await expect(panel.getByText(/Allow processing for the current disclosure in the Privacy & data panel below first/)).toBeVisible();
  await expect(panel.getByText(/declination keeps every Manual path working and nothing generates while processing is not allowed/)).toBeVisible();
  for (const [table, check] of [
    ["app.generated_course", "SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1"],
    ["app.supplement_request", "SELECT count(*)::int AS count FROM app.supplement_request WHERE owner_id=$1"],
    ["app.why_explanation", "SELECT count(*)::int AS count FROM app.why_explanation WHERE owner_id=$1"],
    ["app.ai_draft_request", "SELECT count(*)::int AS count FROM app.ai_draft_request WHERE owner_id=$1"],
    ["app.ai_dispatch_ledger", "SELECT count(*)::int AS count FROM app.ai_dispatch_ledger WHERE owner_id=$1"],
  ] as const) {
    const rows = await database().query<{ count: number }>(check, [owner.userId]);
    expect(rows.rows[0].count, table).toBe(0);
  }
  // An UNCONFIRMED study (saved draft only) denies generation with no effect.
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await page.getByLabel("Synthetic study materials").setInputFiles([{ name: "denied-2.txt", mimeType: "text/plain", buffer: Buffer.from("A second synthetic study kept as an unconfirmed draft.") }]);
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const draftBatch = (await (await created).json()) as Receipt;
  await page.getByRole("button", { name: "Inspect preview · denied-2.txt", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "Acknowledge and select denied-2.txt", exact: false });
  await checkbox.waitFor({ state: "visible", timeout: 120000 });
  await checkbox.check();
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Unconfirmed draft");
  await page.getByLabel("Learning outcomes").fill("Stay unconfirmed");
  await page.getByLabel("Source coverage / missing explanations", { exact: false }).fill("Coverage not assessed.");
  await page.getByLabel("One mini-course title").fill("Draft only");
  await page.getByLabel("Lessons · one per line").fill("One lesson");
  await page.getByLabel("Practice activity").fill("Submit one recall item");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  const unconfirmed = await (await page.request.get(`/api/v1/studies/${draftBatch.rootId}`)).json() as { revision: number; confirmed: unknown };
  expect(unconfirmed.confirmed).toBeNull();
  expect((await page.request.post(`/api/v1/studies/${draftBatch.rootId}/course`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: unconfirmed.revision } })).status()).toBe(409);
  // A STALE command on the confirmed root conflicts honestly; an invalid body
  // is invalid input — neither persists anything.
  const stale = await page.request.post(`/api/v1/studies/${rootId}/course`, { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 9999 } });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "CONFLICT" } });
  const invalid = await page.request.post(`/api/v1/studies/${rootId}/course`, { headers: { Origin: origin }, data: { schemaVersion: 2, commandKey: crypto.randomUUID(), expectedRevision: 0 } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1", [owner.userId])).rows[0].count).toBe(0);
  // Consent arrives: the honest degradation ends, generation works, and the
  // always-erroring fixture fetch fails HONESTLY with saved input and a retry.
  // Reopen the CONFIRMED study first — the draft view has no course stage.
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await page.getByRole("button", { name: "View plan", exact: true }).click();
  await grantConsent(page);
  await expect(generate).toBeEnabled();
  await generate.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
  const check = panel.getByRole("button", { name: "Check gaps against public sources (AI)", exact: true });
  await check.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Supplement check failed — nothing was saved.", { exact: false })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(/A proposed source could not be fetched/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Retry supplement check", exact: true })).toBeVisible();
  const failed = await (await page.request.get(`/api/v1/studies/${rootId}/supplements`)).json() as { state: string };
  expect(failed.state).toBe("failed");
  expect((await database().query<{ count: number }>("SELECT count(*)::int AS count FROM app.course_supplement cs JOIN app.generated_course c ON c.id=cs.course_id WHERE c.owner_id=$1", [owner.userId])).rows[0].count).toBe(0);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("denied-error-set.png"), fullPage: true });
});
