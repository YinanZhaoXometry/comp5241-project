import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { command } from "../../src/app/client";
import type { Plan, Receipt } from "../../src/contracts/setup";

// Browser cases for S5/U5: exact-confirmation handoff honesty. They supplement,
// never replace, the tracer cases and run only at integration against the local
// loopback server with original synthetic content.
const origin = "http://127.0.0.1:3000";
const text = "Synthetic handoff testing: exact confirmed revisions only.";
type Handoff = {
  rootId: string;
  planRevisionId: string;
  selectionId: string;
  confirmedAt: string;
  provenance: string;
  plan: Plan;
  sources: { slotId: string; rootId: string; filename: string; format: string; extractionId: string }[];
  objectIds: string[];
};
type StudyPayload = {
  rootId: string;
  revision: number;
  extractionId: string | null;
  selection: { id: string } | null;
  draft: { id: string; plan: Plan } | null;
  confirmed: { id: string; plan: Plan; sources: { extractionId: string; filename: string }[] } | null;
  slots: { slotId: string; rootId: string; revision: number }[];
};

test.beforeEach(async () => {
  // This suite uses only the isolated synthetic database. Reset the limiter fixture
  // between independent cases, never disable the application's actual limiter.
  await database().query('DELETE FROM auth."rateLimit"');
});
test.afterAll(async () => { await closeDatabase(); });

async function login(page: Page, account: Awaited<ReturnType<typeof provisionSynthetic>>) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
}
async function upload(page: Page, names: string[]) {
  await page.getByLabel("Synthetic study materials").setInputFiles(names.map(name => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) })));
  const response = page.waitForResponse(value => /\/slots\/[^/]+$/u.test(value.url()) && value.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const receipt = await (await response).json() as Receipt;
  for (const name of names) {
    await page.getByRole("button", { name: `Inspect preview · ${name}`, exact: true }).click();
    await page.getByRole("checkbox", { name: `Acknowledge and select ${name}`, exact: false }).check();
  }
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await expect(page.getByLabel("Topic", { exact: true })).toBeEnabled();
  return receipt;
}
async function savePlanViaUi(page: Page, title: string) {
  await page.getByLabel("Topic", { exact: true }).fill("Handoff browser topic");
  await page.getByLabel("Learning outcomes").fill("Confirm the exact handoff revision");
  await page.getByLabel("One mini-course title").fill(title);
  await page.getByLabel("Lessons · one per line").fill("One exact lesson");
  await page.getByLabel("Practice activity").fill("Verify pinned sources");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
}
async function study(page: Page, rootId: string): Promise<StudyPayload> {
  return await (await page.request.get(`/api/v1/studies/${rootId}`)).json() as StudyPayload;
}

test("a confirmed plan shows honest handoff readiness, keeps a duplicate confirmation at one receipt and the library honest", async ({ page }) => {
  const account = await provisionSynthetic("handoff-honesty", "learner");
  await login(page, account);
  const receipt = await upload(page, ["handoff-honesty.txt"]);
  await savePlanViaUi(page, "Honest handoff course");
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  // U5 honesty: handoff readiness without implying any accepted generation job.
  await expect(page.getByText("Plan ready for course generation", { exact: false }).first()).toBeVisible();
  const generate = page.getByRole("button", { name: "Generate course — unavailable in this release", exact: true });
  await expect(generate).toBeDisabled();
  await expect(page.getByText("no generation job", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("handoff-honesty.txt", { exact: false }).first()).toBeVisible();

  const current = await study(page, receipt.rootId);
  expect(current.confirmed).not.toBeNull();
  const handoff = await (await page.request.get(`/api/v1/studies/${receipt.rootId}/handoff`)).json() as Handoff;
  expect(handoff.planRevisionId).toBe(current.confirmed!.id);
  expect(handoff.selectionId).toBe(current.selection!.id);
  expect(handoff.provenance).toBe("Manual");
  expect(handoff.plan.miniCourse.title).toBe("Honest handoff course");
  expect(handoff.sources.map(source => source.filename)).toEqual(["handoff-honesty.txt"]);

  // A different command confirming the same revision inserts no second receipt.
  const again = await page.request.post(`/api/v1/studies/${receipt.rootId}/confirmation`, { headers: { Origin: origin }, data: { ...command(current.revision), planRevisionId: current.confirmed!.id } });
  expect(again.status()).toBe(200);
  expect((await database().query("SELECT plan_id FROM app.plan_confirmation WHERE root_id=$1", [receipt.rootId])).rowCount).toBe(1);

  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByText("Plan confirmed — course not generated", { exact: true })).toBeVisible();
});

test("an unconfirmed newer draft never substitutes in the handoff; reopening shows that new changes need confirmation", async ({ page }) => {
  const account = await provisionSynthetic("handoff-substitute", "learner");
  await login(page, account);
  const receipt = await upload(page, ["handoff-substitute.txt"]);
  await savePlanViaUi(page, "Substitution guard course");
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  const before = await (await page.request.get(`/api/v1/studies/${receipt.rootId}/handoff`)).json() as Handoff;

  // A second tab saves a newer draft; it is never consumed as a replacement.
  const current = await study(page, receipt.rootId);
  const saved = await page.request.post(`/api/v1/studies/${receipt.rootId}/plan`, {
    headers: { Origin: origin },
    data: { ...command(current.revision), plan: { ...before.plan, topic: "Unconfirmed second-tab topic" }, extractionId: current.extractionId, selectionId: current.selection!.id },
  });
  expect(saved.status()).toBe(200);
  const after = await (await page.request.get(`/api/v1/studies/${receipt.rootId}/handoff`)).json() as Handoff;
  expect(after.planRevisionId).toBe(before.planRevisionId);
  expect(after.plan.topic).toBe(before.plan.topic);

  // Reopening the study states the explicit "new changes need confirmation" state;
  // confirming the fresh draft remains a deliberate, separate action.
  await page.getByRole("button", { name: "Back to library" }).click();
  await page.getByRole("button", { name: "View plan", exact: true }).click();
  await expect(page.getByText("New changes need confirmation", { exact: false })).toBeVisible();
});

test("deleting a selected source rejects the handoff and requires updated sources and new confirmation", async ({ page }) => {
  const account = await provisionSynthetic("handoff-deletion", "learner");
  await login(page, account);
  const receipt = await upload(page, ["handoff-keep.txt", "handoff-drop.txt"]);
  await savePlanViaUi(page, "Deletion guard course");
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  expect(((await page.request.get(`/api/v1/studies/${receipt.rootId}/handoff`)).status())).toBe(200);

  await page.getByRole("button", { name: "Remove or replace · handoff-drop.txt", exact: true }).click();
  await page.getByRole("button", { name: "Remove source and dependent plans", exact: true }).click();
  // U5: a deleted or replaced source rejects the handoff; no automatic substitute.
  const denied = await page.request.get(`/api/v1/studies/${receipt.rootId}/handoff`);
  expect(denied.status()).toBe(409);
  expect((await denied.json()).error.code).toBe("CONFLICT");
  await expect(page.getByText("This plan needs updated sources and new confirmation", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Manual draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm exact saved plan" })).toBeDisabled();
});
