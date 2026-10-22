import { describe, expect, it } from "vitest";
import { savePreferencesSchema, validTimeZone } from "../../src/contracts/preferences";

const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
const content = { stage: "goal", goal: null, topic: "", clarification: "", background: "", timePreference: null, timezone: "" };

describe("setup preference contracts", () => {
  it("accepts each of the four goal routes with only Other requiring a short clarification", () => {
    for (const goal of ["Exam preparation", "Understand a topic", "Apply a skill"] as const) {
      expect(savePreferencesSchema.safeParse({ ...command, ...content, goal }).success).toBe(true);
    }
    expect(savePreferencesSchema.safeParse({ ...command, ...content, goal: "Other" }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, goal: "Other", clarification: "   " }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, goal: "Other", clarification: "Prepare a demo" }).success).toBe(true);
    // Only Other takes a clarification; no other goal accepts one.
    expect(savePreferencesSchema.safeParse({ ...command, ...content, goal: "Apply a skill", clarification: "leaked" }).success).toBe(false);
  });
  it("rejects unknown goals/stages/time preferences, over-limit text and unexpected fields", () => {
    expect(savePreferencesSchema.safeParse({ ...command, ...content, goal: "Random goal" }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, stage: "unknown" }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, timePreference: "whenever" }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, topic: "t".repeat(161) }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, background: "b".repeat(401) }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, timezone: "z".repeat(65) }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, unexpected: true }).success).toBe(false);
  });
  it("validates changeable IANA timezones against the canonical supported list", () => {
    expect(validTimeZone("Asia/Shanghai")).toBe(true);
    expect(validTimeZone("UTC")).toBe(true);
    expect(validTimeZone("Mars/Olympus")).toBe(false);
    expect(validTimeZone("asia/shanghai")).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(savePreferencesSchema.safeParse({ ...command, ...content, timezone: "Asia/Shanghai" }).success).toBe(true);
  });
});
