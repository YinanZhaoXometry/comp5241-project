import { describe, expect, it } from "vitest";
import { commandSchema, planSchema, extractionJobSchema, validateText } from "../../src/contracts/setup";

describe("tracer input contracts", () => {
  it("requires versioned commands and rejects forged authority", () => {
    expect(commandSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(commandSchema.safeParse({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0, role: "admin" }).success).toBe(false);
  });
  it("requires short Other clarification and exactly one Manual mini-course", () => {
    const plan = { topic: "Testing", goal: "Other", clarification: "", outcomes: ["Write a test"], miniCourse: { title: "Tests", lessons: ["First test"], practice: "Write a test", estimatedMinutes: 20 }, missingExplanations: "Not assessed" };
    expect(planSchema.safeParse(plan).success).toBe(false);
    expect(planSchema.safeParse({ ...plan, clarification: "Prepare a demo" }).success).toBe(true);
  });
  it("rejects empty, binary, malformed UTF8 and oversized TXT", () => {
    for (const bytes of [Buffer.from(" \n"), Buffer.from([0, 1]), Buffer.from([0xff]), Buffer.alloc(20 * 1024 * 1024 + 1, 65)]) {
      expect(() => validateText(bytes)).toThrow();
    }
    expect(validateText(Buffer.from("Synthetic α <script>not executed</script>"))).toContain("<script>");
  });
  it("rejects content and unsupported versions in queue envelopes", () => {
    expect(extractionJobSchema.safeParse({ schemaVersion: 1, text: "secret" }).success).toBe(false);
  });
});