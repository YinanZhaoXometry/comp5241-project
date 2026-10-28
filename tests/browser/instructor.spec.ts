import { test, expect, type Page } from "@playwright/test";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import type { InstructorReceipt } from "../../src/contracts/instructor-courses";

// Epic-5 entry-1 browser journey over the LIVE instructor routes and the
// enrolled learner path: the instructor signs in on /instructor/courses,
// creates a course, drafts one manual lesson, inspects and approves the exact
// version through the gated Approvals inspector (approver/time/version
// recorded), enrolls one verified learner through the single-row
// preview/confirm action, drafts a SECOND unapproved version, then signs out.
// The learner studies through the LEARNER shell (/enrolled) and sees exactly
// the approved lesson — never the pending draft. A non-enrolled learner, a
// second instructor and an ordinary admin receive the same no-existence-leak
// denial. Synthetic accounts and content only; no AI, no network egress.
const origin = "http://127.0.0.1:3000";
const lessonText = "Synthetic approved lesson body: manual authoring, exact-version approval, no AI.";
const secondDraftText = "Unapproved second-draft text that no learner may ever see.";

test.beforeEach(async () => { await database().query('DELETE FROM auth."rateLimit"'); });
test.afterAll(async () => { await closeDatabase(); });

async function signInOn(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("instructor authors, approves and enrolls; the learner studies only the approved version; denials never leak", async ({ page, playwright }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (!request.url().startsWith(origin)) outbound.push(new URL(request.url()).hostname); });

  const instructor = await provisionSynthetic("instructor-browser", "instructor");
  const learner = await provisionSynthetic("learner-browser", "learner");

  // ── instructor: create the course ──────────────────────────────────────
  await page.setViewportSize({ width: 360, height: 900 });
  await signInOn(page, "/instructor/courses", instructor.email, instructor.password);
  await expect(page.getByRole("heading", { name: "Courses", level: 1, exact: true })).toBeVisible();
  // The honesty label sits in BOTH the sidebar footer (hidden at 360px, where
  // the sidebar collapses to the top nav) and the always-visible topbar pill —
  // assert the visible one, scoped to the header.
  await expect(page.locator("header").getByText("Sample prototype · No live AI", { exact: true })).toBeVisible();
  await expect(page.getByText("No courses yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create course", exact: true }).click();
  await page.getByLabel("Course title", { exact: true }).fill("Browser tracer course");
  await page.getByRole("button", { name: "Create course", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Browser tracer course", exact: true })).toBeVisible();
  await expect(page.getByText("Course created.", { exact: true })).toBeVisible();

  // ── instructor: draft the one manual lesson ────────────────────────────
  await page.getByRole("button", { name: "Open course", exact: true }).click();
  await page.getByLabel("Lesson title", { exact: true }).fill("The manual tracer lesson");
  await page.getByLabel(/Lesson reading text/).fill(lessonText);
  await page.getByRole("button", { name: "Save draft version", exact: true }).click();
  await expect(page.getByText("Draft version saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "v1", exact: true })).toBeVisible();
  await expect(page.getByText("Pending approval", { exact: true }).first()).toBeVisible();

  // ── instructor: inspect and approve the exact version ──────────────────
  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Approvals", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Browser tracer course/ })).toBeVisible();
  // The gate holds: Approve is disabled until the inspection checkbox is set.
  const approveButton = page.getByRole("button", { name: "Approve exact version", exact: true });
  await expect(approveButton).toBeDisabled();
  await expect(page.getByText(lessonText, { exact: true })).toBeVisible();
  await page.getByLabel("I have inspected these exact versions").check();
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText(/Approved exact version v1\./)).toBeVisible();
  await expect(page.getByText("Nothing waiting", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Approved/ }).click();
  await expect(page.getByRole("cell", { name: "Synthetic instructor-browser", exact: true })).toBeVisible();

  // ── instructor: enroll one verified learner (single-row preview/confirm)
  await page.getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("button", { name: "Open course", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser Enrolled");
  await page.getByLabel("Email", { exact: true }).fill(learner.email);
  await page.getByRole("button", { name: "Preview row", exact: true }).click();
  await expect(page.getByText(/Matched verified account: Synthetic learner-browser/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm enrollment", exact: true }).click();
  await expect(page.getByText("Learner enrolled.", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Browser Enrolled", exact: true })).toBeVisible();

  // A second preview of the now-enrolled row reports the duplicate honestly.
  await page.getByLabel("Name", { exact: true }).fill("Browser Enrolled");
  await page.getByLabel("Email", { exact: true }).fill(learner.email);
  await page.getByRole("button", { name: "Preview row", exact: true }).click();
  await expect(page.getByText(/Already enrolled: Synthetic learner-browser/)).toBeVisible();

  // ── instructor: draft a SECOND version that must stay invisible ────────
  await page.getByLabel("Lesson title", { exact: true }).fill("The second draft lesson");
  await page.getByLabel(/Lesson reading text/).fill(secondDraftText);
  await page.getByRole("button", { name: "Save draft version", exact: true }).click();
  await expect(page.getByText(/A draft version is pending approval/)).toBeVisible();

  // ── learner: studies through the learner shell, never the studio ───────
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Signed out. Views cleared.", { exact: true })).toBeVisible();
  // The auth limiter fixture is reset between the grouped sign-in phases of
  // this single long test (the course.spec beforeEach precedent): better-
  // auth's per-endpoint sign-in limit is far below this journey's seven
  // sign-ins, and only this test's own synthetic rows are cleared.
  await database().query('DELETE FROM auth."rateLimit"');
  await signInOn(page, "/enrolled", learner.email, learner.password);
  await expect(page.getByRole("heading", { name: "Enrolled courses", level: 1, exact: true })).toBeVisible();
  const courseRow = page.getByRole("article").filter({ hasText: "Browser tracer course" });
  await expect(courseRow.getByText(/Studying approved version v1/)).toBeVisible();
  await courseRow.getByRole("link", { name: "Study lesson", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The manual tracer lesson", exact: true })).toBeVisible();
  await expect(page.getByText(lessonText, { exact: true })).toBeVisible();
  await expect(page.getByText(/Required: Read lesson 1: The manual tracer lesson/)).toBeVisible();
  await expect(page.getByText(/v1 · approved/).first()).toBeVisible();
  // No other version or draft byte reaches the learner surface.
  await expect(page.getByText(secondDraftText)).toHaveCount(0);
  await expect(page.getByText("The second draft lesson")).toHaveCount(0);
  const studyPayload = await (await page.request.get(`/api/v1/enrollments/${(await database().query<{ id: string }>("SELECT id FROM app.instructor_course WHERE title='Browser tracer course'")).rows[0].id}`)).json() as unknown;
  expect(JSON.stringify(studyPayload)).not.toContain(secondDraftText);
  expect(JSON.stringify(studyPayload)).not.toContain("The second draft lesson");

  // ── denials: non-enrolled learner, second instructor, ordinary admin ───
  const stranger = await provisionSynthetic("stranger-browser", "learner");
  const secondInstructor = await provisionSynthetic("second-instructor-browser", "instructor");
  const admin = await provisionSynthetic("admin-browser", "admin");
  await database().query('DELETE FROM auth."rateLimit"');
  const courseId = (await database().query<{ id: string }>("SELECT id FROM app.instructor_course WHERE title='Browser tracer course'")).rows[0].id;
  for (const account of [stranger, secondInstructor, admin]) {
    const context = await playwright.request.newContext({ baseURL: origin });
    const signIn = await context.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: account.email, password: account.password } });
    expect(signIn.status()).toBe(200);
    const denied = await context.get(`/api/v1/enrollments/${courseId}`);
    expect(denied.status()).toBe(404);
    const body = (await denied.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: "FORBIDDEN_OR_NOT_FOUND", message: "This item is unavailable.", requestId: expect.any(String), retryable: false });
    await context.dispose();
  }

  // The live instructor page denies a learner's session the studio surfaces.
  const learnerContext = await playwright.request.newContext({ baseURL: origin });
  await learnerContext.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: learner.email, password: learner.password } });
  expect((await learnerContext.get("/api/v1/instructor/courses")).status()).toBe(404);
  expect((await learnerContext.get("/api/v1/instructor/approvals")).status()).toBe(404);
  await learnerContext.dispose();

  // Duplicate approve over HTTP: same command key replays one receipt.
  const instructorContext = await playwright.request.newContext({ baseURL: origin });
  await instructorContext.post("/api/v1/auth/sign-in/email", { headers: { Origin: origin }, data: { email: instructor.email, password: instructor.password } });
  const versionId = (await database().query<{ id: string }>("SELECT id FROM app.instructor_course_version WHERE course_id=$1 AND version=1", [courseId])).rows[0].id;
  const duplicate = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, courseId, versionId };
  const first = await instructorContext.post(`/api/v1/instructor/courses/${courseId}/approve`, { headers: { Origin: origin }, data: duplicate });
  expect(first.status()).toBe(200);
  const second = await instructorContext.post(`/api/v1/instructor/courses/${courseId}/approve`, { headers: { Origin: origin }, data: duplicate });
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual(await first.json() as InstructorReceipt);
  expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_approval WHERE version_id=$1", [versionId])).rows[0].count).toBe(1);
  await instructorContext.dispose();

  // Desktop width and the shell keyboard contract hold on the live pages.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/instructor/courses");
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/enrolled");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
  void info;
});
