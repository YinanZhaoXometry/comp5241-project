import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";

// U3 processing-disclosure browser cases. Synthetic only: every configuration
// fixture below is a labeled synthetic test configuration, the panel must
// present it as a test mode, and the outbound request spy must stay empty.
const origin = "http://127.0.0.1:3000";
test.beforeEach(async () => {
  await database().query('DELETE FROM auth."rateLimit"');
});
test.afterAll(async () => {
  await closeDatabase();
});
async function insertConfiguration(eligibility: "eligible" | "ineligible") {
  const max = await database().query<{ max: number | null }>("SELECT max(version) AS max FROM app.processor_configuration");
  const version = (max.rows[0].max ?? 0) + 1;
  await database().query(
    `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
     VALUES($1,$2,'Synthetic test spy (local only — not compliant live AI)','Boundary demonstration purpose','["synthetic excerpts"]'::jsonb,'Synthetic test configuration. Nothing leaves this machine.',$3,true,3)`,
    [crypto.randomUUID(), version, eligibility],
  );
  return version;
}
async function login(page: Page) {
  const actor = await provisionSynthetic("consent-browser", "learner");
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Password", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  return actor;
}
function spyOutbound(page: Page) {
  const outbound: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) outbound.push(request.url());
  });
  return outbound;
}

test("eligible synthetic disclosure shows the prominent test label, requires explicit opt-in and withdraws fail-closed", async ({ page }, info) => {
  await insertConfiguration("eligible");
  const outbound = spyOutbound(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await login(page);
  const panel = page.getByRole("region", { name: "AI processing disclosure" });
  await expect(panel.getByText(/Synthetic test configuration — not compliant live AI/)).toBeVisible();
  // No consent solicited before opt-in: the decision starts at none, nothing is
  // preselected, and the full disclosure (purpose, categories, retention) shows.
  expect(await page.request.get("/api/v1/processing").then((response) => response.json())).toMatchObject({
    decision: "none",
    configuration: { eligibility: "eligible", syntheticTest: true },
  });
  await expect(panel.getByText(/Purpose: Boundary demonstration purpose/)).toBeVisible();
  await expect(panel.getByText(/Categories: synthetic excerpts/)).toBeVisible();
  await expect(panel.getByText(/Retention and exceptions: Synthetic test configuration/)).toBeVisible();
  const allow = panel.getByRole("button", { name: "Allow AI processing", exact: true });
  await allow.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Allowed · disclosure version/)).toBeVisible();
  expect(await page.request.get("/api/v1/processing").then((response) => response.json())).toMatchObject({ decision: "granted" });
  await page.screenshot({ path: info.outputPath("allowed-synthetic-disclosure.png"), fullPage: true });
  await panel.getByRole("button", { name: "Review withdrawal", exact: true }).click();
  await expect(panel.getByText(/Prior disclosed processing cannot be undone/)).toBeVisible();
  await panel.getByRole("button", { name: "Keep consent", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Review withdrawal", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Review withdrawal", exact: true }).click();
  await panel.getByRole("button", { name: "Withdraw consent", exact: true }).click();
  await expect(panel.getByText(/Processing is stopped for the future/)).toBeVisible();
  await expect(panel.getByText(/delete materials and their dependent plans from the study workspace/)).toBeVisible();
  expect(await page.request.get("/api/v1/processing").then((response) => response.json())).toMatchObject({ decision: "withdrawn" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(outbound).toEqual([]);
});

test("declining keeps manual work available, offers Enable AI later and never calls out", async ({ page }) => {
  await insertConfiguration("eligible");
  const outbound = spyOutbound(page);
  await login(page);
  const panel = page.getByRole("region", { name: "AI processing disclosure" });
  await expect(panel.getByText(/Synthetic test configuration — not compliant live AI/)).toBeVisible();
  await panel.getByRole("button", { name: "Not now", exact: true }).click();
  // Exact match: the decline confirmation (status output) and the declined
  // state paragraph intentionally share the same opening sentence.
  await expect(panel.getByText("AI processing declined. Manual topic and plan editing stay available.", { exact: true })).toBeVisible();
  expect(await page.request.get("/api/v1/processing").then((response) => response.json())).toMatchObject({ decision: "declined" });
  await panel.getByRole("button", { name: "Enable AI later", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Allow AI processing", exact: true })).toBeVisible();
  expect(outbound).toEqual([]);
});

test("an ineligible configuration never solicits consent and keeps manual paths available", async ({ page }) => {
  await insertConfiguration("ineligible");
  const outbound = spyOutbound(page);
  await login(page);
  const panel = page.getByRole("region", { name: "AI processing disclosure" });
  await expect(panel.getByText("AI processing is unavailable under the current privacy policy.", { exact: false })).toBeVisible();
  await expect(panel.getByText(/Manual setup, saving, export and deletion remain available/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Allow AI processing", exact: true })).toHaveCount(0);
  expect(await page.request.get("/api/v1/processing").then((response) => response.json())).toMatchObject({
    decision: "none",
    configuration: { eligibility: "ineligible" },
  });
  expect(outbound).toEqual([]);
});
