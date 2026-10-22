import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import { command } from "../../src/app/client";
import type { Receipt } from "../../src/contracts/setup";

const origin = "http://127.0.0.1:3000";
const text = "Synthetic unit testing: arrange, act, assert. <script>throw new Error('not executed')</script>";
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
async function upload(page: Page, name = "synthetic.txt") {
  await page.getByLabel("Synthetic study materials").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  const response = page.waitForResponse(value => /\/slots\/[^/]+$/u.test(value.url()) && value.request().method() === "POST");
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  const receipt = await (await response).json() as Receipt;
  await page.getByRole("button", { name: `Inspect preview · ${name}`, exact: true }).click();
  await page.getByRole("checkbox", { name: `Acknowledge and select ${name}`, exact: false }).check();
  await page.getByRole("button", { name: "Continue with acknowledged selection", exact: true }).click();
  await expect(page.getByLabel("Topic", { exact: true })).toBeEnabled();
  const study = await (await page.request.get(`/api/v1/studies/${receipt.rootId}`)).json();
  return { ...receipt, operationId: study.slots[0].operationId } as Receipt;
}

test("keyboard/360px/desktop journey: upload, escaped preview, four goals, exact Manual confirmation, reopen and removal", async ({ page }, info) => {
  const account = await provisionSynthetic("browser-owner", "learner");
  const errors: string[] = []; const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, account);
  await page.keyboard.press("Tab");
  const uploaded = await upload(page);
  await expect(page.locator("pre")).toHaveText(text);
  await expect(page.getByLabel("Learning goal").locator("option")).toHaveText(["Exam preparation", "Understand a topic", "Apply a skill", "Other"]);
  await page.getByLabel("Topic", { exact: true }).fill("Unit testing");
  await page.getByLabel("Learning goal").selectOption("Other");
  await page.getByLabel("Short clarification for Other").fill("Write my first deterministic test");
  await page.getByLabel("Learning outcomes").fill("Write a deterministic unit test");
  await page.getByLabel("One mini-course title").fill("Your first test");
  await page.getByLabel("Lessons · one per line").fill("Arrange, act, assert");
  await page.getByLabel("Practice activity").fill("Test an addition function");
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan confirmed — course not generated", exact: true })).toBeFocused();
  const before = await (await page.request.get(`/api/v1/studies/${uploaded.rootId}/plan`)).json();
  expect(before.confirmed.plan.goal).toBe("Other");
  await page.reload();
  await page.getByRole("button", { name: "View plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your first test", exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/v1/studies/${uploaded.rootId}/plan`)).json()).toEqual(before);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Review removal" }).click();
  await page.getByRole("button", { name: "Cancel removal" }).click();
  await expect(page.getByRole("button", { name: "Review removal" })).toBeFocused();
  await page.getByRole("button", { name: "Review removal" }).click();
  await page.getByRole("button", { name: "Delete material and dependent plans" }).click();
  await expect(page.getByRole("heading", { name: "Deletion receipt" })).toBeVisible();
  expect((await page.request.get(`/api/v1/studies/${uploaded.rootId}`)).status()).toBe(404);
  expect(outbound).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("synthetic-library.png"), fullPage: true });
});

for (const role of ["learner", "instructor", "admin"] as const) {
test(`independently replays captured requests as ${role} and after revocation; rejects malformed, CSRF and self-promotion`, async ({ page, playwright }) => {
  const a = await provisionSynthetic("replay-owner", "learner");
  await login(page, a); const uploaded = await upload(page, "private-marker.txt");
  const paths = [`studies/${uploaded.rootId}`, `studies/${uploaded.rootId}/material`, `studies/${uploaded.rootId}/text`, `studies/${uploaded.rootId}/plan`, `operations/${uploaded.operationId}`];
    const account = await provisionSynthetic(`denied-${role}`, role);
    const other = await playwright.request.newContext({ baseURL: origin });
    try {
      await apiLogin(other, account);
      for (const path of paths) {
        const response = await other.get(`/api/v1/${path}`);
        expect(response.status()).toBe(404);
        const body = await response.json(); expect(body.error.code).toBe("FORBIDDEN_OR_NOT_FOUND");
        expect(JSON.stringify(body)).not.toContain("private-marker"); expect(JSON.stringify(body)).not.toContain(text);
        expect(response.headers()["cache-control"]).toContain("no-store");
      }
      expect((await other.post(`/api/v1/studies/${uploaded.rootId}/removal`, { headers: { Origin: origin }, data: command(1) })).status()).toBe(404);
    } finally { await other.dispose(); }
  expect((await page.request.post("/api/v1/auth/sign-up/email", { headers: { Origin: origin }, data: { role: "admin" } })).status()).toBe(404);
  expect((await page.request.post(`/api/v1/studies/${uploaded.rootId}/plan`, { headers: { Origin: "https://untrusted.invalid" }, data: command(1) })).status()).toBe(404);
  expect((await page.request.post(`/api/v1/studies/${uploaded.rootId}/plan`, { headers: { Origin: origin }, data: { ...command(1), role: "admin" } })).status()).toBe(400);
  await database().query('DELETE FROM auth.session WHERE "userId"=$1', [a.userId]);
  for (const path of paths) expect((await page.request.get(`/api/v1/${path}`)).status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("pre")).toHaveCount(0);
});
}

test("sign-in keeps the real sensitive-route throttle and reports 429, not invalid credentials", async ({ playwright }) => {
  const account = await provisionSynthetic("throttle", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    for (let index = 0; index < 3; index++) await apiLogin(client, account);
    const denied = await client.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: account.email, password: account.password } });
    expect(denied.status()).toBe(429);
    expect((await denied.json()).error.code).toBe("RATE_LIMITED");
  } finally { await client.dispose(); }
});

test("GET session lookup is read-only; refresh occurs by POST and logout revokes database sessions", async ({ playwright }) => {
  const account = await provisionSynthetic("refresh", "learner");
  const client = await playwright.request.newContext({ baseURL: origin });
  try {
    await apiLogin(client, account);
    await database().query('UPDATE auth.session SET "expiresAt"=clock_timestamp()+interval \'1 hour\',"updatedAt"=clock_timestamp()-interval \'2 hours\' WHERE "userId"=$1', [account.userId]);
    const before = (await database().query('SELECT id,"expiresAt","updatedAt" FROM auth.session WHERE "userId"=$1', [account.userId])).rows;
    const lookup = await client.get("/api/v1/auth/get-session");
    expect((await lookup.json()).needsRefresh).toBe(true);
    expect((await database().query('SELECT id,"expiresAt","updatedAt" FROM auth.session WHERE "userId"=$1', [account.userId])).rows).toEqual(before);
    expect((await client.post("/api/v1/auth/get-session", { headers: { Origin: origin }, data: {} })).ok()).toBe(true);
    expect((await database().query('SELECT "expiresAt" FROM auth.session WHERE "userId"=$1', [account.userId])).rows[0].expiresAt.getTime()).toBeGreaterThan(before[0].expiresAt.getTime());
    expect((await client.post("/api/v1/auth/sign-out", { headers: { Origin: origin }, data: {} })).ok()).toBe(true);
    expect((await client.get("/api/v1/studies")).status()).toBe(401);
  } finally { await client.dispose(); }
});

async function fillManual(page: Page, title = "Visible plan P") {
  await page.getByLabel("Topic", { exact: true }).fill("Synthetic race testing");
  await page.getByLabel("Learning outcomes").fill("Confirm the visible saved revision");
  await page.getByLabel("One mini-course title").fill(title);
  await page.getByLabel("Lessons · one per line").fill("One deterministic lesson");
  await page.getByLabel("Practice activity").fill("Check exact saved content");
}

test("pending save locks fields; reload keeps edits unconfirmed; a second root can be deleted", async ({ page }) => {
  await login(page, await provisionSynthetic("editor-race", "learner"));
  const root = await upload(page, "first-root.txt"); await fillManual(page);
  let reached!: () => void; let release!: () => void;
  const atSave = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/studies/${root.rootId}/plan`, async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch(); reached(); await resume; await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click(); await atSave;
  try { await expect(page.getByLabel("One mini-course title")).toBeDisabled(); } finally { release(); }
  await expect(page.getByText(/Saved Manual draft · revision/)).toBeVisible();
  await page.unroute(`**/api/v1/studies/${root.rootId}/plan`);
  const current = await (await page.request.get(`/api/v1/studies/${root.rootId}`)).json();
  expect((await page.request.post(`/api/v1/studies/${root.rootId}/plan`, { headers: { Origin: origin }, data: { ...command(current.revision), extractionId: current.extractionId, selectionId: current.selection.id, plan: { ...current.draft.plan, miniCourse: { ...current.draft.plan.miniCourse, title: "Unseen plan Q" } } } })).status()).toBe(200);
  await page.getByRole("button", { name: "Reload latest revision · keep my edits" }).click();
  await expect(page.getByLabel("One mini-course title")).toHaveValue("Visible plan P");
  await expect(page.getByRole("button", { name: "Confirm exact saved plan" })).toBeDisabled();
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm exact saved plan" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm exact saved plan" }).click();
  await expect(page.getByRole("heading", { name: "Visible plan P", exact: true })).toBeVisible();
  for (let index = 0; index < 2; index++) {
    await page.getByRole("button", { name: "Review removal" }).click();
    await page.getByRole("button", { name: "Delete material and dependent plans" }).click();
    await expect(page.getByRole("heading", { name: "Deletion receipt" })).toBeVisible();
    if (index === 0) await upload(page, "second-root.txt");
  }
  expect((await page.request.get("/api/v1/studies")).ok()).toBe(true);
});

test("study polling stops once every slot has finished extraction work", async ({ page }) => {
  await login(page, await provisionSynthetic("poll-idle", "learner"));
  const root = await upload(page, "poll-idle.txt");
  await page.getByRole("button", { name: "Back to library" }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Topic", { exact: true })).toBeVisible();
  await page.waitForTimeout(1100); // Let any straggling pre-gating poll fire before counting.
  let reads = 0;
  page.on("request", request => { if (request.method() === "GET" && request.url().endsWith(`/api/v1/studies/${root.rootId}`)) reads += 1; });
  await page.waitForTimeout(2600);
  expect(reads).toBe(0);
});

test("an authorized old response cannot restore A's private view under B's session", async ({ page }) => {  const a = await provisionSynthetic("late-a", "learner"); const b = await provisionSynthetic("late-b", "learner");
  await login(page, a); const root = await upload(page, "late-private-a.txt");
  await page.getByRole("button", { name: "Back to library" }).click();
  let reached!: () => void; let release!: () => void;
  const atRead = new Promise<void>(resolve => { reached = resolve; }); const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/studies/${root.rootId}`, async route => { const response = await route.fetch(); reached(); await resume; await route.fulfill({ response }); });
  await page.getByRole("button", { name: "Resume", exact: true }).click(); await atRead;
  await page.request.post("/api/v1/auth/sign-out", { headers: { Origin: origin }, data: {} }); await apiLogin(page.request, b);
  await page.evaluate(() => { const channel = new BroadcastChannel("private-study-session"); channel.postMessage("clear"); channel.close(); });
  await expect(page.getByText("Signed in as Synthetic late-b")).toBeVisible();
  const response = page.waitForResponse(value => value.url().endsWith(`/studies/${root.rootId}`)); release(); await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator("pre")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My study library", exact: true })).toBeVisible();
});

test("retryable extraction keeps polling until a real worker success appears", async ({ page }) => {
  await login(page, await provisionSynthetic("retry-visible", "learner")); const root = await upload(page, "retry-visible.txt");
  await page.getByRole("button", { name: "Back to library" }).click();
  const actual = await (await page.request.get(`/api/v1/studies/${root.rootId}`)).json();
  let reads = 0;
  await page.route(`**/api/v1/studies/${root.rootId}`, async route => {
    // The first response represents the observable interval between real attempts;
    // later responses are the actual already-committed worker result, not AI output.
    // Poll-activeness derives from slot state, so the mask covers the slot too.
    reads += 1;
    const masked = { ...actual, extractionId: null, text: null, draft: null, confirmed: null, slots: [{ ...actual.slots[0], state: "retryable-failed", extractionId: null, metadata: null, pending: false }], operation: actual.operation ? { ...actual.operation, state: "retryable-failed" } : null };
    await route.fulfill({ json: reads === 1 ? masked : actual });
  });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Topic", { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(1);
});

test("a concurrent draft saved between command and reload is never silently confirmed", async ({ page }) => {
  await login(page, await provisionSynthetic("save-other-tab", "learner"));
  const root = await upload(page, "concurrent-draft.txt"); await fillManual(page);
  let reached!: () => void; let release!: () => void;
  const committed = new Promise<void>(resolve => { reached = resolve; }); const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/studies/${root.rootId}/plan`, async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch(); reached(); await resume; await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save Manual draft", exact: true }).click(); await committed;
  const current = await (await page.request.get(`/api/v1/studies/${root.rootId}`)).json();
  expect((await page.request.post(`/api/v1/studies/${root.rootId}/plan`, { headers: { Origin: origin }, data: { ...command(current.revision), extractionId: current.extractionId, selectionId: current.selection.id, plan: { ...current.draft.plan, topic: "Unseen topic from another client" } } })).status()).toBe(200);
  release();
  await expect(page.getByLabel("One mini-course title")).toBeEnabled();
  await expect(page.getByLabel("Topic", { exact: true })).toHaveValue("Synthetic race testing");
  await expect(page.getByRole("button", { name: "Confirm exact saved plan" })).toBeDisabled();
  expect((await (await page.request.get(`/api/v1/studies/${root.rootId}/plan`)).json()).confirmed).toBeNull();
});