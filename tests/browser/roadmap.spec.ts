import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { insertParentManifest } from "../../src/modules/assessment-progress/repository";
import type { AttemptSnapshot } from "../../src/contracts/assessment";
import type { Receipt } from "../../src/contracts/setup";

// Epic-3 story-6 browser journey: the whole-mini-course roadmap surface. A
// builds three generated studies plus one confirmed-but-ungenerated study:
// the roadmap renders one node per entire mini-course with states that
// follow completion awards exactly — a failed-group course reads In progress
// with a Needs practice pill while a completed sibling stays Completed, an
// untouched course reads Not started, and the ungenerated one renders the
// honest "Plan confirmed — course not generated" line. A planted parent
// manifest (the 3.4 synthetic-fixture precedent) groups three releases into
// one recommended path in its PINNED order — numbering only: every node
// stays freely browsable (an Open action on each, no locks, no XP), driven
// keyboard-only at 360px and re-checked at desktop width. With the
// versioned review-state port unbound (this build's default) no Review due
// pill renders anywhere and the panel says so in words; completion states
// are unchanged. B (another learner) reads only their own roadmap — no leak.
// Synthetic account and content only; zero outbound requests.
const origin = "http://127.0.0.1:3000";
const sources = [
  { name: "roadmap-0.txt", text: "Synthetic roadmap source one. A second sentence gives the lesson body some structure." },
  { name: "roadmap-1.txt", text: "Synthetic roadmap source two. Doubles and coverage appear here for a second section." },
];
const outcomes = ["Recall the first source", "Explain the second source"];

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

async function currentConfiguration() {
  const max = await database().query<{ version: number; eligibility: string; daily_admission_limit: number }>("SELECT version, eligibility, daily_admission_limit FROM app.processor_configuration ORDER BY version DESC LIMIT 1");
  return max.rows[0];
}
async function eligibleConfigurationVersion() {
  const current = await currentConfiguration();
  if (current?.eligibility === "eligible" && current.daily_admission_limit >= 2) return current.version;
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

// Upload, acknowledge and confirm one study with the given topic/title; the
// roadmap panel keeps rendering across the workspace transitions.
async function uploadAndConfirm(page: Page, topic: string, title: string) {
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
  await page.getByLabel("Topic", { exact: true }).fill(topic);
  await page.getByLabel("Learning outcomes").fill(outcomes.join("\n"));
  await page.getByLabel("Source coverage / missing explanations", { exact: false }).fill("Coverage not assessed. No supplementary sources fetched.");
  await page.getByLabel("One mini-course title").fill(title);
  await page.getByLabel("Lessons · one per line").fill(["One generated lesson"].join("\n"));
  await page.getByLabel("Practice activity").fill("Submit one recall item");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  return batch.rootId;
}

async function generateViaUi(page: Page) {
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Generate mini-course (AI)", exact: true }).click();
  await expect(coursePanel.getByRole("heading", { name: "1. One generated lesson", exact: true })).toBeVisible({ timeout: 60000 });
}

async function backToLibrary(page: Page) {
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
}

async function snapshotOf(rootId: string): Promise<AttemptSnapshot> {
  const row = await database().query<{ snapshot: AttemptSnapshot }>(
    "SELECT snapshot FROM app.test_attempt WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1",
    [rootId],
  );
  if (!row.rows[0]) throw new Error("no attempt row");
  return row.rows[0].snapshot;
}

test("the roadmap renders whole-mini-course nodes that follow awards exactly, a planted recommended order, free keyboard browsing, and no review pill while the port is unbound", async ({ page, playwright }, info) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 900 });
  const account = await login(page, "roadmap-browser-a");
  await grantConsent(page);
  const roadmap = page.locator("section").filter({ has: page.getByRole("heading", { name: "Study roadmap", exact: true }) });
  await expect(roadmap).toBeVisible();
  // The unbound review port is stated in words; no pill renders anywhere.
  await expect(roadmap.getByText("Review scheduling is not part of this build", { exact: false })).toBeVisible();

  // Study 1 — will end COMPLETED (items done + all-correct attempt).
  const root1 = await uploadAndConfirm(page, "Roadmap browser topic one", "Roadmap browser course one");
  const nodeOf = (title: string) => roadmap.locator("li").filter({ hasText: title });
  await expect(nodeOf("Roadmap browser course one").getByText("Plan confirmed — course not generated.", { exact: true })).toBeVisible();
  await generateViaUi(page);
  await expect(nodeOf("Roadmap browser course one").getByText("Not started", { exact: true })).toBeVisible({ timeout: 20000 });
  const coursePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your mini-course", exact: true }) });
  await coursePanel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true }).click();
  const assessment = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assessment & progress", exact: true }) });
  await assessment.getByRole("button", { name: "Start the required test", exact: true }).click();
  await expect(assessment.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const snap1 = await snapshotOf(root1);
  for (const item of snap1.items) {
    const label = item.choices.find(choice => choice.id === item.answerId)!.text;
    await page.getByRole("radio", { name: label, exact: true }).check();
  }
  await assessment.getByRole("button", { name: "Submit test (5/5 answered)", exact: true }).click();
  await expect(nodeOf("Roadmap browser course one").getByText("Completed", { exact: true })).toBeVisible({ timeout: 20000 });

  // Study 2 — the honest 79.96% boundary failure: In progress + Needs
  // practice while the completed sibling stays Completed.
  await backToLibrary(page);
  const root2 = await uploadAndConfirm(page, "Roadmap browser topic two", "Roadmap browser course two");
  await generateViaUi(page);
  await coursePanel.getByRole("button", { name: "Mark lesson 1 reading done", exact: true }).click();
  await assessment.getByRole("button", { name: "Start the required test", exact: true }).click();
  await expect(assessment.getByText("Attempt open — 0 of 5 answered.", { exact: false })).toBeVisible();
  const snap2 = await snapshotOf(root2);
  for (const item of snap2.items.slice(0, 4)) {
    const label = item.choices.find(choice => choice.id === item.answerId)!.text;
    await page.getByRole("radio", { name: label, exact: true }).check();
  }
  const wrongFifth = snap2.items[4].choices.find(choice => choice.id !== snap2.items[4].answerId)!;
  await page.getByRole("radio", { name: wrongFifth.text, exact: true }).check();
  await assessment.getByRole("button", { name: "Submit test (5/5 answered)", exact: true }).click();
  await expect(assessment.getByRole("strong").filter({ hasText: "79.96% — Not passed (mark is 80%)" })).toBeVisible({ timeout: 15000 });
  await expect(nodeOf("Roadmap browser course two").getByText("In progress", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(nodeOf("Roadmap browser course two").getByText("Needs practice", { exact: true })).toBeVisible();
  await expect(nodeOf("Roadmap browser course one").getByText("Completed", { exact: true })).toBeVisible();
  await expect(nodeOf("Roadmap browser course one").getByText("Needs practice")).toHaveCount(0);

  // Study 3 — generated, untouched: Not started.
  await backToLibrary(page);
  await uploadAndConfirm(page, "Roadmap browser topic three", "Roadmap browser course three");
  await generateViaUi(page);
  await expect(nodeOf("Roadmap browser course three").getByText("Not started", { exact: true })).toBeVisible({ timeout: 20000 });

  // Study 4 — confirmed, never generated: the honest not-generated line.
  await backToLibrary(page);
  await uploadAndConfirm(page, "Roadmap browser topic four", "Roadmap browser course four");
  await expect(nodeOf("Roadmap browser course four").getByText("Plan confirmed — course not generated.", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(nodeOf("Roadmap browser course four").getByText("Review due")).toHaveCount(0); // unbound port — never a wrong state

  // Plant the parent manifest (the 3.4 synthetic-fixture precedent) pinning
  // the three generated releases in an order that is deliberately NOT the
  // confirmation order: three, one, two.
  const courses = await database().query<{ id: string; root_id: string }>(
    "SELECT id,root_id FROM app.generated_course WHERE owner_id=$1 AND status='ready' ORDER BY created_at",
    [account.userId],
  );
  expect(courses.rows).toHaveLength(3);
  const byRoot = new Map(courses.rows.map(row => [row.root_id, row.id]));
  const manifestId = crypto.randomUUID();
  const client = await database().connect();
  try {
    await insertParentManifest(client, {
      id: crypto.randomUUID(), manifestId, ownerId: account.userId, rootId: root1,
      manifest: { schemaVersion: 1, children: [
        // Deliberate non-chronological pin: course three first.
        { courseId: courses.rows.find(row => row.root_id !== root1 && row.root_id !== root2)!.id, required: true },
        { courseId: byRoot.get(root1)!, required: true },
        { courseId: byRoot.get(root2)!, required: true },
      ] },
    });
  } finally { await client.release(); }
  // The roadmap groups the three into ONE recommended path in the pinned
  // order; the ungenerated study stays its own single-node path.
  const path = roadmap.locator(".tracker-row").filter({ hasText: "Recommended path" });
  await expect(path).toBeVisible({ timeout: 20000 });
  await expect(path.locator("li")).toHaveCount(3);
  await expect(path.locator("li").nth(0).getByText("Roadmap browser course three")).toBeVisible();
  await expect(path.locator("li").nth(1).getByText("Roadmap browser course one")).toBeVisible();
  await expect(path.locator("li").nth(2).getByText("Roadmap browser course two")).toBeVisible();
  // Path-level honesty: one unawarded required child keeps the path pending.
  await expect(path.getByText("path Completed")).toHaveCount(0);
  // Free browsing, keyboard-only: Tab onto the Not-started node's Open
  // action and Enter — every node is open at any time, nothing is locked.
  const openThree = path.locator("li").nth(0).getByRole("button", { name: "Open this mini-course", exact: true });
  await openThree.focus();
  await expect(openThree).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "From source to study plan", exact: true })).toBeVisible();
  await backToLibrary(page);
  // The ungenerated study's node opens freely too — no state gates browsing.
  const openFour = nodeOf("Roadmap browser course four").getByRole("button", { name: "Open this mini-course", exact: true });
  await openFour.click();
  await expect(page.getByRole("heading", { name: "From source to study plan", exact: true })).toBeVisible();
  await backToLibrary(page);
  // No Review due pill rendered anywhere across the whole journey.
  await expect(roadmap.getByText("Review due")).toHaveCount(0);
  // Honest and overflow-free at 360px and desktop.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(roadmap.getByRole("heading", { name: "Study roadmap", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  // B (another learner) reads only their own roadmap — no leak of A's
  // studies in the served payload.
  const stranger = await provisionSynthetic("roadmap-browser-b", "learner");
  const strangerContext = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await strangerContext.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: stranger.email, password: stranger.password } })).status()).toBe(200);
    const theirs = await strangerContext.get("/api/v1/roadmap", { headers: { Origin: origin } });
    expect(theirs.status()).toBe(200);
    const body = await theirs.text();
    expect(body).not.toContain("Roadmap browser course");
    expect(body).not.toContain(root1);
  } finally { await strangerContext.dispose(); }
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("roadmap-surface.png"), fullPage: true });
});
