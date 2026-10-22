import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { command } from "../../src/app/client";
import { syntheticCatalog } from "../../src/modules/setup-diagnostic/bundle";
import type { Receipt } from "../../src/contracts/setup";

const origin = "http://127.0.0.1:3000";
// Beyond-criteria probes: the fourth item is never submitted in the journey,
// so its rationale and its correct-choice identification must never reach the
// page or the pre-submission API payloads. The choice list itself — including
// the correct option's text — must stay visible for the item to be answerable.
const withheldItem = syntheticCatalog.items[3];
const withheldProbes = [withheldItem.rationale];
const sources = [
  { name: "diag-0.txt", text: "Synthetic diagnostic source one" },
  { name: "diag-1.txt", text: "Synthetic diagnostic source two" },
];
test.beforeEach(async () => { await database().query('DELETE FROM auth."rateLimit"'); });
test.afterAll(async () => { await closeDatabase(); });
async function login(page: Page) {
  const account = await provisionSynthetic("check-browser", "learner");
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  return account;
}
async function uploadAndConfirm(page: Page, outcomes: string[]) {
  await page.getByLabel("Synthetic study materials").setInputFiles(sources.map(source => ({ name: source.name, mimeType: "text/plain", buffer: Buffer.from(source.text) })));
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const batch = (await (await created).json()) as Receipt;
  for (const source of sources) {
    // The acknowledge checkbox lives inside the per-slot preview disclosure.
    await page.getByRole("button", { name: `Inspect preview · ${source.name}`, exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: `Acknowledge and select ${source.name}`, exact: false });
    await checkbox.waitFor({ state: "visible", timeout: 120000 });
    await checkbox.check();
  }
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic diagnostic topic");
  await page.getByLabel("Learning outcomes").fill(outcomes.join("\n"));
  await page.getByLabel("One mini-course title").fill("Check course");
  await page.getByLabel("Lessons · one per line").fill("One deterministic lesson");
  await page.getByLabel("Practice activity").fill("Check the recorded evidence");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  return batch.rootId;
}

test("optional check: equal Take/Skip offer, answers withheld until submission, distinct paths, no completion credit", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const outbound: string[] = [];
  const checkBodies: Promise<string>[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  page.on("response", response => { if (response.url().includes("/check")) checkBodies.push(response.text().catch(() => "")); });
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page);
  const rootId = await uploadAndConfirm(page, ["Synthetic outcome 1", "Synthetic outcome 2", "Synthetic outcome 3"]);
  // Equally visible offer from the confirmed plan.
  const heading = page.getByRole("heading", { name: "Optional starting check", exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Take 3–5-question starting check", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now", exact: true })).toBeVisible();
  await expect(page.getByText("MANUALLY AUTHORED · NO LIVE AI")).toBeVisible();
  const taken = page.waitForResponse(response => response.url().endsWith(`/api/v1/studies/${rootId}/check`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Take 3–5-question starting check", exact: true }).click();
  const bundle = (await (await taken).json()) as Receipt & { bundleId: string };
  await expect(page.getByText("Item 1 of 4")).toBeVisible();
  // Pre-submission: neither page HTML nor check payloads may carry answers.
  for (const probe of withheldProbes) expect(await page.content()).not.toContain(probe);
  await page.getByRole("radio", { name: "Unaided", exact: true }).check();
  await page.locator("#check-choice-1-b").check();
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await expect(page.getByText("Recorded outcome: correct", { exact: false })).toBeVisible();
  expect(await page.content()).toContain(syntheticCatalog.items[0].rationale); // revealed only now
  await page.getByRole("button", { name: "Flag as unclear", exact: true }).click();
  await expect(page.getByText("flagged unclear").first()).toBeVisible();
  await page.locator("#check-choice-2-a").check();
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await expect(page.getByText("Recorded outcome: incorrect", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Skip this item · stays Unknown", exact: true }).click();
  await expect(page.getByText("left unanswered · Unknown").first()).toBeVisible();
  await page.getByRole("button", { name: "Finish check · leave the rest Unknown", exact: true }).click();
  await expect(page.getByText("Check finished.", { exact: false })).toBeVisible();
  // The finished summary appears in both the status output and the pinned
  // item-set note; either presence satisfies the count assertion.
  await expect(page.getByText("2 submitted · 2 Unknown").first()).toBeVisible();
  await expect(page.getByText("never creates completion awards", { exact: false })).toBeVisible();
  // Direct conversion attempt and payload scan.
  expect((await page.request.post(`/api/v1/studies/${rootId}/check/${bundle.bundleId}/complete`, { headers: { Origin: origin }, data: {} })).status()).toBe(404);
  const state = await (await page.request.get(`/api/v1/studies/${rootId}/check`)).json() as { items: Array<{ position: number; evidence: unknown }> };
  const serialized = JSON.stringify(state);
  for (const probe of withheldProbes) expect(serialized).not.toContain(probe);
  for (const banned of ['"score"', '"credit"', '"completion"']) expect(serialized).not.toContain(banned);
  const withheldView = state.items.find(item => item.position === 4);
  expect(withheldView?.evidence).toBeNull();
  expect(JSON.stringify(withheldView)).not.toContain("correctChoiceId");
  expect(JSON.stringify(withheldView)).not.toContain("rationale");
  for (const body of await Promise.all(checkBodies)) for (const probe of withheldProbes) expect(body).not.toContain(probe);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("synthetic-check-finished.png"), fullPage: true });
});

test("unavailable check still finishes setup: skip is recorded without penalty and take honestly fails", async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page);
  const single = [{ name: "diag-0.txt", text: "Synthetic diagnostic source one" }];
  await page.getByLabel("Synthetic study materials").setInputFiles(single.map(source => ({ name: source.name, mimeType: "text/plain", buffer: Buffer.from(source.text) })));
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const batch = (await (await created).json()) as Receipt;
  const checkbox = page.getByRole("checkbox", { name: `Acknowledge and select ${single[0].name}`, exact: false });
  await page.getByRole("button", { name: `Inspect preview · ${single[0].name}`, exact: true }).click();
  await checkbox.waitFor({ state: "visible", timeout: 120000 });
  await checkbox.check();
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Single outcome topic");
  await page.getByLabel("Learning outcomes").fill("One single synthetic outcome");
  await page.getByLabel("One mini-course title").fill("Small course");
  await page.getByLabel("Lessons · one per line").fill("One lesson");
  await page.getByLabel("Practice activity").fill("Inspect one source");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  await expect(page.getByText("The starting check is unavailable for this confirmed plan revision", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now", exact: true })).toBeVisible();
  const study = (await (await page.request.get(`/api/v1/studies/${batch.rootId}`)).json()) as { revision: number };
  const attempt = await page.request.post(`/api/v1/studies/${batch.rootId}/check`, { headers: { Origin: origin }, data: command(study.revision) });
  expect(attempt.status()).toBe(400);
  expect(((await attempt.json()) as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByText("Skipped for now — setup is complete without penalty.", { exact: true })).toBeVisible();
  const state = (await (await page.request.get(`/api/v1/studies/${batch.rootId}/check`)).json()) as { skipRecorded: boolean; status: string };
  expect(state.skipRecorded).toBe(true);
  expect(state.status).toBe("unavailable");
  expect(errors).toEqual([]);
});
