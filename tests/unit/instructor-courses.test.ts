import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  MANUAL_COURSE_ITEM_ID,
  approveVersionSchema,
  confirmEnrollmentSchema,
  createCourseSchema,
  enrollmentPreviewSchema,
  manualCourseContentSchema,
  manualCourseItem,
  saveDraftSchema,
  storedManualContent,
} from "../../src/contracts/instructor-courses";
import { requestHash } from "../../src/platform/commands";

// Epic-5 entry 1 contract coverage: the manual content document parses only
// in its exact shape, the derived required item is stable, the enrollment
// row validates email/name honestly, and the content digest is deterministic
// (same lesson ⇒ same digest; any edit ⇒ a different digest).

const command = () => ({ schemaVersion: 1 as const, commandKey: crypto.randomUUID(), expectedRevision: 0 });
const lesson = { title: "One manual lesson", sections: [{ text: "Synthetic manual lesson body." }] };

describe("epic-5 5.1 contracts", () => {
  it("accepts the one-lesson manual content document and derives the stable required item", () => {
    const content = manualCourseContentSchema.parse({ contentVersion: 1, lesson });
    expect(content.lesson.title).toBe("One manual lesson");
    const item = manualCourseItem(content.lesson);
    expect(item).toEqual({
      id: MANUAL_COURSE_ITEM_ID,
      kind: "reading",
      required: true,
      title: "Read lesson 1: One manual lesson",
    });
    // The stored-row parse round-trips and rejects anything else.
    expect(storedManualContent({ contentVersion: 1, lesson })).toEqual(content);
    expect(storedManualContent({ contentVersion: 2, lesson })).toBeNull();
    expect(storedManualContent({ contentVersion: 1, lesson: { ...lesson, sections: [] } })).toBeNull();
  });

  it("rejects over- and under-sized lessons and sections", () => {
    expect(manualCourseContentSchema.safeParse({ contentVersion: 1, lesson: { ...lesson, sections: [...lesson.sections, ...Array.from({ length: 4 }, () => ({ text: "x" }))] } }).success).toBe(false);
    expect(manualCourseContentSchema.safeParse({ contentVersion: 1, lesson: { ...lesson, sections: [{ text: "  " }] } }).success).toBe(false);
    expect(manualCourseContentSchema.safeParse({ contentVersion: 1, lesson: { ...lesson, title: "" } }).success).toBe(false);
  });

  it("validates the command envelopes", () => {
    expect(createCourseSchema.safeParse({ ...command(), title: "Synthetic tracer course" }).success).toBe(true);
    expect(createCourseSchema.safeParse({ ...command(), title: " " }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...command(), title: "x".repeat(161) }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ ...command(), courseId: crypto.randomUUID(), lesson }).success).toBe(true);
    expect(saveDraftSchema.safeParse({ ...command(), expectedRevision: -1, courseId: crypto.randomUUID(), lesson }).success).toBe(false);
    expect(approveVersionSchema.safeParse({ ...command(), courseId: crypto.randomUUID(), versionId: crypto.randomUUID() }).success).toBe(true);
    expect(confirmEnrollmentSchema.safeParse({ ...command(), courseId: crypto.randomUUID(), name: "Synthetic Learner", email: "learner@synthetic.invalid" }).success).toBe(true);
    expect(confirmEnrollmentSchema.safeParse({ ...command(), courseId: crypto.randomUUID(), name: "Synthetic Learner", email: "not-an-email" }).success).toBe(false);
    expect(enrollmentPreviewSchema.safeParse({ schemaVersion: 1, name: "Synthetic Learner", email: "LEARNER@Synthetic.Invalid" }).success).toBe(true);
    expect(enrollmentPreviewSchema.safeParse({ schemaVersion: 1, name: "", email: "learner@synthetic.invalid" }).success).toBe(false);
    expect(enrollmentPreviewSchema.safeParse({ schemaVersion: 1, name: "Synthetic Learner", email: "learner@synthetic.invalid", commandKey: crypto.randomUUID() }).success).toBe(false);
  });

  it("digests the exact content deterministically — any edit changes the digest", () => {
    const content = { contentVersion: 1 as const, lesson };
    const digest = requestHash(content);
    expect(digest).toBe(createHash("sha256").update(JSON.stringify(content)).digest("hex"));
    expect(requestHash(content)).toBe(digest);
    expect(requestHash({ contentVersion: 1, lesson: { ...lesson, sections: [{ text: "Edited body." }] } })).not.toBe(digest);
    expect(requestHash({ contentVersion: 1, lesson: { ...lesson, title: "Edited title" } })).not.toBe(digest);
  });
});
