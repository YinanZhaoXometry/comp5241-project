import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import type { ExportPreview } from "../../src/contracts/export";

const origin = "http://127.0.0.1:3000";
const text = "Synthetic export browser fixture: arrange, act, assert.";
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
async function apiLogin(request: APIRequestContext, account: Awaited<ReturnType<typeof provisionSynthetic>>) {
  const response = await request.post(`${origin}/api/v1/auth/sign-in/email`, { headers: { Origin: origin }, data: { email: account.email, password: account.password } });
  expect(response.status(), `Synthetic sign-in HTTP status ${response.status()}`).toBe(200);
}
async function uploadViaUi(page: Page) {
  await page.getByLabel("Synthetic study materials").setInputFiles({ name: "export-fixture.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  await page.getByRole("button", { name: "Inspect preview · export-fixture.txt", exact: true }).click();
  await page.getByRole("checkbox", { name: "Acknowledge and select export-fixture.txt", exact: false }).check();
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await expect(page.getByLabel("Topic", { exact: true })).toBeEnabled();
}
async function requests(page: Page) {
  return (await (await page.request.get("/api/v1/exports")).json()) as ExportPreview;
}

test("export scope shows before request; one ready authenticated download; explicit regeneration only", async ({ page }, info) => {
  const account = await provisionSynthetic("export-owner", "learner");
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await login(page, account);
  await uploadViaUi(page);
  const panel = page.getByRole("region", { name: "Export your setup data" });
  // U7: scope and included derivative categories are visible before any request.
  await expect(panel.getByRole("heading", { name: "Included categories" })).toBeVisible();
  await expect(panel.getByText("Original materials: 1")).toBeVisible();
  await expect(panel.getByText("Diagnostic evidence: Not present in this deployment")).toBeVisible();
  await expect(panel.getByText(/snapshot pins your setup data exactly as captured/i)).toBeVisible();
  await panel.getByRole("button", { name: "Request export snapshot" }).click();
  // The local worker builds the queued snapshot; the panel polls until ready.
  await expect(panel.getByText("Ready for authenticated download.")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Download export · tar.gz" })).toBeVisible();
  await expect(panel.getByText(/expires .+ \(at most 24 hours\)/)).toBeVisible();
  const preview = await requests(page);
  expect(preview.requests).toHaveLength(1);
  const requestId = preview.requests[0].id;
  // Authenticated download: no-store, attachment, real gzip bytes.
  const response = await page.request.get(`/api/v1/exports/${requestId}/download`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  const bytes = await response.body();
  expect(bytes[0]).toBe(0x1f);
  expect(bytes[1]).toBe(0x8b);
  // Never an anonymous or cross-owner GET; other owners see no requests at all.
  const anonymous = await page.context().browser()!.newContext({ baseURL: origin });
  const other = await provisionSynthetic("export-other", "learner");
  const otherContext = await page.context().browser()!.newContext({ baseURL: origin });
  try {
    expect((await anonymous.request.get(`/api/v1/exports/${requestId}/download`)).status()).toBe(401);
    await apiLogin(otherContext.request, other);
    expect((await otherContext.request.get(`/api/v1/exports/${requestId}/download`)).status()).toBe(404);
    const otherPreview = (await (await otherContext.request.get("/api/v1/exports")).json()) as ExportPreview;
    expect(otherPreview.requests).toHaveLength(0);
  } finally {
    await anonymous.close();
    await otherContext.close();
  }
  // 360px and desktop stay inside the viewport; regeneration is explicit.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.getByRole("button", { name: "Regenerate export" }).click();
  await expect(panel.getByText("Ready for authenticated download.")).toHaveCount(2);
  expect((await requests(page)).requests).toHaveLength(2);
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("synthetic-export-panel.png"), fullPage: true });
});

test("expiry shows the honest purged state, Regenerate builds fresh, sign-out denies download", async ({ page }) => {
  const account = await provisionSynthetic("export-expiry", "learner");
  await login(page, account);
  await uploadViaUi(page);
  const panel = page.getByRole("region", { name: "Export your setup data" });
  await panel.getByRole("button", { name: "Request export snapshot" }).click();
  await expect(panel.getByText("Ready for authenticated download.")).toBeVisible();
  const first = await requests(page);
  await database().query("UPDATE app.export_request SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND state='ready'", [first.requests[0].id]);
  await page.reload();
  const region = page.getByRole("region", { name: "Export your setup data" });
  await expect(region.getByText("Expired — the active copy was purged and can no longer be downloaded.")).toBeVisible();
  expect((await page.request.get(`/api/v1/exports/${first.requests[0].id}/download`)).status()).toBe(404);
  await region.getByRole("button", { name: "Regenerate export" }).click();
  await expect(region.getByText("Ready for authenticated download.")).toBeVisible();
  const renewed = await requests(page);
  expect(renewed.requests).toHaveLength(2);
  expect(renewed.requests[0].state).toBe("ready");
  const readyId = renewed.requests[0].id;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect((await page.request.get("/api/v1/exports")).status()).toBe(401);
  expect((await page.request.get(`/api/v1/exports/${readyId}/download`)).status()).toBe(401);
});
