import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";

// S9/U8 browser cases over the extracted danger zone: dependency preview by
// category with cancel-default, separate whole-personal deletion, and honest
// receipts. Synthetic account and content only; runs against the local server
// and worker at integration after the integrator applies the mount snippets.
const origin = "http://127.0.0.1:3000";
const sample = [{ name: "lifecycle.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic lifecycle deletion source. Nothing here is real.") }];
test.beforeEach(async () => { await database().query('DELETE FROM auth."rateLimit"'); });
test.afterAll(async () => { await closeDatabase(); });
async function login(page: Page, label: string) {
  const actor = await provisionSynthetic(label, "learner");
  await page.goto("/"); await page.getByLabel("Email", { exact: true }).fill(actor.email); await page.getByLabel("Password", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  return actor;
}
async function upload(page: Page) {
  await page.getByLabel("Synthetic study materials").setInputFiles(sample);
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click(); await (await created).json();
  await expect(page.getByRole("button", { name: "Inspect preview · lifecycle.txt", exact: true })).toBeVisible({ timeout: 60000 });
}

test("material removal previews dependencies by category, keeps cancel default and then revokes the root", async ({ page }, info) => {
  const errors: string[] = []; const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name)); page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(request.url()); });
  await login(page, "lifecycle-browser-root"); await upload(page);
  await page.getByRole("button", { name: "Review removal", exact: true }).click();
  // Category preview appears before any destructive action; counts only.
  await expect(page.getByText("Original files: 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Extracted text revisions: 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/Unrelated material roots and instructor-controlled records are not selected/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel removal", exact: true }).click();
  // Cancel is the safe default and returns focus to the opener.
  await expect(page.getByRole("button", { name: "Review removal", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review removal", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Review removal", exact: true }).click();
  await expect(page.getByText("Original files: 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete material and dependent plans", exact: true }).click();
  await expect(page.getByText(/Access revoked\. Active-copy cleanup is pending or complete/)).toBeVisible();
  await expect(page.getByText(/Access revoked · cleanup/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  for (const width of [360, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.screenshot({ path: info.outputPath("revoked-material-receipt.png"), fullPage: true });
  expect(errors).toEqual([]); expect(outbound).toEqual([]);
});

test("whole-personal deletion is a separate flow with its own preview, cancel default and seven-day deadline receipt", async ({ page }, info) => {
  const errors: string[] = []; const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name)); page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(request.url()); });
  await login(page, "lifecycle-browser-personal"); await upload(page);
  await page.getByRole("button", { name: "Review personal data deletion", exact: true }).click();
  await expect(page.getByText(/Every study under your account is selected/)).toBeVisible();
  await expect(page.getByText("Original files: 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel personal deletion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review personal data deletion", exact: true })).toBeFocused();
  // The separate material-removal flow was untouched by the canceled personal one.
  await expect(page.getByRole("button", { name: "Review removal", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review personal data deletion", exact: true }).click();
  await expect(page.getByText(/Every study under your account is selected/)).toBeVisible();
  await page.getByRole("button", { name: "Delete all my personal study data", exact: true }).click();
  await expect(page.getByText(/Personal study data deletion accepted \(pending\)/)).toBeVisible();
  await expect(page.getByText(/seven-day deadline; receipts expire within thirty days/)).toBeVisible();
  await expect(page.getByText(/Access revoked · cleanup/)).toBeVisible();
  // Refresh resumes the authorized revoked state; nothing is resurrected.
  await page.reload();
  await expect(page.getByText(/Access revoked · cleanup/)).toBeVisible();
  for (const width of [360, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.screenshot({ path: info.outputPath("personal-deletion-receipt.png"), fullPage: true });
  expect(errors).toEqual([]); expect(outbound).toEqual([]);
});

test("dependency preview and removal endpoints deny another role and deleted scopes without leaking content", async ({ page, playwright }) => {
  const owner = await login(page, "lifecycle-browser-denied"); await upload(page);
  const study = await (await page.request.get("/api/v1/studies")).json();
  const rootId = study[0].rootId as string;
  const account = await provisionSynthetic("lifecycle-browser-other", "instructor"); const client = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: account.email, password: account.password } })).status()).toBe(200);
    const denied = await client.post(`/api/v1/studies/${rootId}/dependencies`, { headers: { Origin: origin }, data: { schemaVersion: 1 } });
    expect(denied.status()).toBe(404); expect(await denied.text()).not.toContain("lifecycle.txt");
    expect((await client.post("/api/v1/personal/removal", { headers: { Origin: origin }, data: { schemaVersion: 1, preview: true } })).status()).toBe(200);
    const foreign = await client.post("/api/v1/personal/removal", { headers: { Origin: origin }, data: { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 } });
    expect(foreign.status()).toBe(200);
    expect(JSON.stringify(await foreign.json())).not.toContain("lifecycle");
  } finally { await client.dispose(); }
  await database().query('DELETE FROM auth.session WHERE "userId"=$1', [owner.userId]);
  expect((await page.request.post(`/api/v1/studies/${rootId}/dependencies`, { headers: { Origin: origin }, data: { schemaVersion: 1 } })).status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible(); await expect(page.locator("pre")).toHaveCount(0);
});
