import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { docx, pdf } from "../fixtures/documents";
import { command } from "../../src/app/client";

const origin = "http://127.0.0.1:3000";
test.beforeEach(async () => { await database().query('DELETE FROM auth."rateLimit"'); });
test.afterAll(async () => { await closeDatabase(); });
async function login(page: Page) {
  const actor = await provisionSynthetic("four-format-browser", "learner");
  await page.goto("/"); await page.getByLabel("Email", { exact: true }).fill(actor.email); await page.getByLabel("Password", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
  return actor;
}
const sample = [
  { name: "source.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic text <script>never executed</script>") },
  { name: "source.md", mimeType: "text/markdown", buffer: Buffer.from("# Synthetic Markdown\n![never fetched](https://external.invalid/image)") },
  { name: "source.pdf", mimeType: "application/pdf", buffer: pdf() },
  { name: "source.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx() },
  { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nbroken") },
];
test("four-format mixed batch requires inspected acknowledgment, preserves exact sources, and invalidates A+B without losing B", async ({ page }, info) => {
  test.setTimeout(150000);
  const errors: string[] = []; const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name)); page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(request.url()); });
  await page.setViewportSize({ width: 360, height: 900 }); await login(page);
  await page.getByLabel("Synthetic study materials").setInputFiles(sample);
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click(); const batch = await (await created).json();
  // Five serialized parsers may legitimately outlive the default UI assertion;
  // still require a completed result inside the story's 120-second boundary.
  await expect(page.getByText("Corrupt or invalid document", { exact: true })).toBeVisible({ timeout: 120000 });
  await expect(page.getByRole("button", { name: "Save Manual draft", exact: true })).toBeDisabled();
  for (const file of sample.slice(0, 4)) {
    await page.getByRole("button", { name: `Inspect preview · ${file.name}`, exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: `Acknowledge and select ${file.name}`, exact: false });
    await checkbox.focus(); await page.keyboard.press("Space"); await expect(checkbox).toBeChecked();
  }
  await expect(page.getByText("Warnings: literal-markdown", { exact: true })).toBeVisible();
  await expect(page.getByText(/Warnings: layout-omitted, nontext-omitted/)).toHaveCount(2);
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await expect(page.getByText("Excluded: broken.pdf · permanent-failed", { exact: true })).toBeVisible();
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic source comparison");
  await page.getByLabel("Learning outcomes").fill("Inspect all source revisions"); await page.getByLabel("One mini-course title").fill("Four source formats");
  await page.getByLabel("Lessons · one per line").fill("Check source coverage"); await page.getByLabel("Practice activity").fill("Compare source locations");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click(); await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan", exact: true }).click();
  let study = await (await page.request.get(`/api/v1/studies/${batch.rootId}`)).json();
  expect(study.confirmed.sources).toHaveLength(4); expect(study.confirmed.sources.map((source: { filename: string }) => source.filename)).toEqual(sample.slice(0, 4).map(file => file.name));
  const original = await page.request.get(`/api/v1/studies/${study.slots[2].rootId}/material`);
  expect(original.headers()["content-type"]).toBe("application/octet-stream"); expect(original.headers()["content-disposition"]).toContain("attachment"); expect(await original.body()).toEqual(sample[2].buffer);
  for (const width of [360, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.screenshot({ path: info.outputPath("acknowledged-four-format-plan.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove or replace · source.txt", exact: true }).click(); await page.getByRole("button", { name: "Remove source and dependent plans", exact: true }).click();
  study = await (await page.request.get(`/api/v1/studies/${batch.rootId}`)).json(); expect(study.confirmed).toBeNull(); expect(study.slots[1].state).toBe("preview");
  await expect(page.getByRole("heading", { name: "Four source formats", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect preview · source.md", exact: true }).click();
  expect(errors).toEqual([]); expect(outbound).toEqual([]);
});

test("rejects eleven selected files before admission and supports failed-file retry and replacement", async ({ page }) => {
  await login(page);
  await page.getByLabel("Synthetic study materials").setInputFiles(Array.from({ length: 11 }, (_, i) => ({ ...sample[0], name: `${i}.txt` })));
  await page.getByRole("button", { name: "Upload materials", exact: true }).click(); await expect(page.getByText(/Choose up to ten PDF/)).toBeVisible();
  expect(await (await page.request.get("/api/v1/studies")).json()).toEqual([]);
  await page.getByLabel("Synthetic study materials").setInputFiles(sample[4]); await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  await expect(page.getByText("Corrupt or invalid document", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry saved input · broken.pdf", exact: true }).click(); await expect(page.getByText("Corrupt or invalid document", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove or replace · broken.pdf", exact: true }).click(); await page.getByRole("button", { name: "Remove source and dependent plans", exact: true }).click();
  await page.getByLabel("Synthetic study materials").setInputFiles(sample[0]); await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  await page.getByRole("button", { name: "Inspect preview · source.txt", exact: true }).click(); await page.getByRole("checkbox", { name: "Acknowledge and select source.txt", exact: false }).check();
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click(); await expect(page.getByLabel("Topic", { exact: true })).toBeEnabled();
});

for (const role of ["learner", "instructor", "admin"] as const) {
test(`new preview/download/selection/control/upload endpoints deny ${role} and revoked sessions`, async ({ page, playwright }) => {
  const owner = await login(page); await page.getByLabel("Synthetic study materials").setInputFiles(sample[0]);
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click(); const batch = await (await created).json();
  await expect(page.getByRole("button", { name: "Inspect preview · source.txt", exact: true })).toBeVisible();
  const study = await (await page.request.get(`/api/v1/studies/${batch.rootId}`)).json(); const slot = study.slots[0];
    const account = await provisionSynthetic(`batch-denied-${role}`, role); const client = await playwright.request.newContext({ baseURL: origin });
    try {
      expect((await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: account.email, password: account.password } })).status()).toBe(200);
      for (const path of [`sources/${slot.rootId}/${slot.extractionId}`, `studies/${slot.rootId}/material`]) { const response = await client.get(`/api/v1/${path}`); expect(response.status()).toBe(404); expect(await response.text()).not.toContain("Synthetic text"); }
      for (const [path, body] of [
        [`batches/${batch.rootId}/selection`, { ...command(), selected: [{ slotId: slot.slotId, extractionId: slot.extractionId, acknowledged: true }], excluded: [] }],
        [`batches/${batch.rootId}/slots/${slot.slotId}/control`, { ...command(), action: "cancel" }],
        [`batches/${batch.rootId}/inputs`, { ...command(), inputs: [{ slotId: crypto.randomUUID(), filename: "source.txt", mime: "text/plain", byteLength: 16 }] }],
      ] as const) expect((await client.post(`/api/v1/${path}`, { headers: { Origin: origin }, data: body })).status()).toBe(404);
      expect((await client.post(`/api/v1/batches/${batch.rootId}/slots/${slot.slotId}`, { headers: { Origin: origin, "Content-Type": "application/octet-stream", "x-schema-version": "1", "x-expected-revision": "0", "idempotency-key": crypto.randomUUID() }, data: sample[0].buffer })).status()).toBe(404);
    } finally { await client.dispose(); }
  await database().query('DELETE FROM auth.session WHERE "userId"=$1', [owner.userId]);
  expect((await page.request.get(`/api/v1/sources/${slot.rootId}/${slot.extractionId}`)).status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible(); await expect(page.locator("pre")).toHaveCount(0);
});
}