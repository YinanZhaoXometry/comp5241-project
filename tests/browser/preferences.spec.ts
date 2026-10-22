import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { command } from "../../src/app/client";
import type { Receipt } from "../../src/contracts/setup";

const origin = "http://127.0.0.1:3000";
const text = "Synthetic goal stage: manual topic and resumable preferences.";
// This suite uses only the isolated synthetic database. Reset the limiter fixture
// between independent cases, never disable the application's actual limiter.
test.beforeEach(async () => { await database().query('DELETE FROM auth."rateLimit"'); });
test.afterAll(async () => { await closeDatabase(); });
async function login(page: Page, account: Awaited<ReturnType<typeof provisionSynthetic>>) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
}
async function upload(page: Page, name = "goal-stage.txt") {
  await page.getByLabel("Synthetic study materials").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  const response = page.waitForResponse(value => /\/slots\/[^/]+$/u.test(value.url()) && value.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const receipt = await (await response).json() as Receipt;
  await page.getByRole("button", { name: `Inspect preview · ${name}`, exact: true }).click();
  await page.getByRole("checkbox", { name: `Acknowledge and select ${name}`, exact: false }).check();
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await expect(page.getByLabel("Topic", { exact: true })).toBeEnabled();
  return receipt;
}

test("keyboard/360px journey: manual topic, four goal routes, Other clarification, optional preferences, invalid timezone and resume after reload", async ({ page }, info) => {
  const account = await provisionSynthetic("goal-owner", "learner");
  const errors: string[] = []; const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, account);
  await upload(page);
  await expect(page.getByRole("heading", { name: "02 · Topic & goal", exact: true })).toBeVisible();
  // Exactly the four goal routes; the topic entry is labeled Manual, never AI.
  await expect(page.getByLabel("Goal", { exact: true }).locator("option")).toHaveText(["Not set", "Exam preparation", "Understand a topic", "Apply a skill", "Other"]);
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toBeVisible();
  await page.getByLabel("Topic (Manual)", { exact: true }).fill("Unit testing");
  await page.getByLabel("Goal", { exact: true }).selectOption("Other");
  const clarification = page.getByLabel("Short clarification · Other goal", { exact: true });
  await expect(clarification).toBeVisible();
  // Other without its short clarification is rejected as a field error, not a save.
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText("Add a short clarification for Other.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Saved · revision/)).toHaveCount(0);
  await clarification.fill("Write my first deterministic test");
  // An invented timezone fails with a field error and stays unsaved.
  const zone = page.getByLabel("Timezone (IANA)", { exact: true });
  await zone.fill("Mars/Olympus");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText("Enter a valid IANA timezone.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Saved · revision/)).toHaveCount(0);
  await zone.fill("Asia/Shanghai");
  // Optional preferences are skippable; filling them here must not block the save.
  await page.getByLabel("Background (optional, short)", { exact: true }).fill("Self-taught synthetic learner");
  await page.getByLabel("Time preference (optional)", { exact: true }).selectOption("morning");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/Saved · revision 1\./)).toBeVisible();
  // Back/refresh resumes exactly the saved server revision.
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toHaveValue("Unit testing");
  await expect(page.getByLabel("Goal", { exact: true })).toHaveValue("Other");
  await expect(page.getByLabel("Short clarification · Other goal", { exact: true })).toHaveValue("Write my first deterministic test");
  await expect(page.getByLabel("Background (optional, short)", { exact: true })).toHaveValue("Self-taught synthetic learner");
  await expect(page.getByLabel("Time preference (optional)", { exact: true })).toHaveValue("morning");
  await expect(page.getByLabel("Timezone (IANA)", { exact: true })).toHaveValue("Asia/Shanghai");
  await expect(page.getByText(/Resumed saved setup · revision 1\./)).toBeVisible();
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(outbound).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("synthetic-goal-stage.png"), fullPage: true });
});

test("a stale second-tab save shows an actionable revision conflict and keeps in-memory edits", async ({ page }) => {
  await login(page, await provisionSynthetic("goal-conflict", "learner"));
  await upload(page, "conflict-goal.txt");
  await page.getByLabel("Topic (Manual)", { exact: true }).fill("First tab topic");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/Saved · revision 1\./)).toBeVisible();
  const saved = await (await page.request.get("/api/v1/preferences")).json() as { revision: number };
  expect(saved.revision).toBe(1);
  // A second tab commits a different topic against the current revision.
  const secondTab = await page.request.put("/api/v1/preferences", { headers: { Origin: origin }, data: { ...command(saved.revision), stage: "goal", goal: null, topic: "Second tab topic", clarification: "", background: "", timePreference: null, timezone: "Asia/Shanghai" } });
  expect(secondTab.status()).toBe(200);
  // The first tab still holds revision 1: its save must CONFLICT, not overwrite.
  await page.getByLabel("Topic (Manual)", { exact: true }).fill("First tab edited topic");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/saved setup changed in another tab/)).toBeVisible();
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toHaveValue("First tab edited topic");
  await page.getByRole("button", { name: "Reload saved · keep my edits", exact: true }).click();
  await expect(page.getByText(/Latest saved revision 2 loaded/)).toBeVisible();
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toHaveValue("First tab edited topic");
  // Reapplying the edit saves against the reloaded revision.
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/Saved · revision 3\./)).toBeVisible();
});

test("optional preferences are skippable and preference-only saves do not advance the revision", async ({ page }) => {
  await login(page, await provisionSynthetic("goal-optional", "learner"));
  await upload(page, "optional-goal.txt");
  // Selecting only a goal is sufficient; every preference is optional.
  await page.getByLabel("Goal", { exact: true }).selectOption("Apply a skill");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/Saved · revision 1\./)).toBeVisible();
  await page.getByLabel("Background (optional, short)", { exact: true }).fill("Career switcher");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/Saved · revision 1\./)).toBeVisible();
  const view = await (await page.request.get("/api/v1/preferences")).json() as { goal: string | null; background: string; timePreference: string | null; timezone: string; revision: number };
  expect(view).toMatchObject({ goal: "Apply a skill", background: "Career switcher", timePreference: null, revision: 1 });
});

test("sign-out clears private fields; a different account starts empty; re-authentication reloads only authorized saved work", async ({ page }) => {
  const a = await provisionSynthetic("goal-owner-a", "learner");
  const b = await provisionSynthetic("goal-owner-b", "learner");
  await login(page, a);
  await upload(page, "private-goal.txt");
  await page.getByLabel("Topic (Manual)", { exact: true }).fill("Private marker A");
  await page.getByRole("button", { name: "Save topic & goal", exact: true }).click();
  await expect(page.getByText(/Saved · revision 1\./)).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toHaveCount(0);
  await login(page, b);
  await upload(page, "other-goal.txt");
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, a);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Topic (Manual)", { exact: true })).toHaveValue("Private marker A");
  await expect(page.getByText(/Resumed saved setup · revision 1\./)).toBeVisible();
});
