import { describe, expect, it } from "vitest";
import {
  decideSchema,
  withdrawSchema,
  dispatchScopeSchema,
  disclosureSchema,
  currentDecisionState,
} from "../../src/contracts/consent";

const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };

describe("consent contracts", () => {
  it("requires explicit, unpreselected consent against an exact disclosure version", () => {
    const grant = { ...command, configurationVersion: 2, decision: "granted", acknowledgedTerms: true };
    expect(decideSchema.safeParse(grant).success).toBe(true);
    for (const value of [
      { ...grant, acknowledgedTerms: false },
      { ...grant, acknowledgedTerms: "yes" },
      { ...grant, configurationVersion: 0 },
      { ...grant, configurationVersion: 1.5 },
      { ...grant, decision: "allow" },
      { ...grant, decision: "withdrawn" },
      { ...grant, extra: true },
    ]) {
      expect(decideSchema.safeParse(value).success).toBe(false);
    }
    // Decline is a first-class explicit decision; a withdrawal is never accepted here.
    expect(decideSchema.safeParse({ ...grant, decision: "declined", acknowledgedTerms: true }).success).toBe(true);
  });
  it("keeps withdrawal commands strict and scoped", () => {
    expect(withdrawSchema.safeParse(command).success).toBe(true);
    expect(withdrawSchema.safeParse({ ...command, allow: true }).success).toBe(false);
  });
  it("rejects content, rosters and oversized identifier lists in dispatch scopes", () => {
    const scope = { commandKey: crypto.randomUUID(), objectIds: [crypto.randomUUID()] };
    expect(dispatchScopeSchema.safeParse(scope).success).toBe(true);
    for (const value of [
      { ...scope, objectIds: [] },
      { ...scope, objectIds: Array.from({ length: 17 }, () => crypto.randomUUID()) },
      { ...scope, objectIds: ["not-a-uuid"] },
      { ...scope, excerpt: "selected source text" },
      { ...scope, ids: [crypto.randomUUID()] },
    ]) {
      expect(dispatchScopeSchema.safeParse(value).success).toBe(false);
    }
  });
  it("derives the honest decision state, including stale disclosure and durable withdrawal", () => {
    const at = (offset: number) => new Date(Date.parse("2026-10-22T00:00:00Z") + offset);
    expect(currentDecisionState([], 2)).toBe("none");
    expect(currentDecisionState([{ decision: "granted", disclosure_version: 2, decided_at: at(0) }], 2)).toBe("granted");
    // An older grant no longer answers a changed disclosure: re-consent is required.
    expect(currentDecisionState([{ decision: "granted", disclosure_version: 2, decided_at: at(0) }], 3)).toBe("none");
    expect(currentDecisionState([{ decision: "declined", disclosure_version: 2, decided_at: at(0) }], 3)).toBe("none");
    // Withdrawal stays withdrawn across disclosure changes (protective state);
    // a post-withdrawal grant is unreachable through the service (integration
    // case), so the pure derivation only ever sees it in its recorded order.
    expect(
      currentDecisionState(
        [
          { decision: "granted", disclosure_version: 2, decided_at: at(0) },
          { decision: "withdrawn", disclosure_version: 2, decided_at: at(1) },
        ],
        3,
      ),
    ).toBe("withdrawn");
    expect(
      currentDecisionState(
        [
          { decision: "declined", disclosure_version: 2, decided_at: at(0) },
          { decision: "granted", disclosure_version: 3, decided_at: at(1) },
        ],
        3,
      ),
    ).toBe("granted");
    // The latest row wins when rows arrive unordered.
    expect(
      currentDecisionState(
        [
          { decision: "granted", disclosure_version: 3, decided_at: at(2) },
          { decision: "declined", disclosure_version: 3, decided_at: at(3) },
        ],
        3,
      ),
    ).toBe("declined");
  });
  it("validates the pinned public disclosure shape", () => {
    const configuration = {
      version: 2,
      provider: "Synthetic test spy (local only — not compliant live AI)",
      purpose: "Boundary demonstration",
      categories: ["selected source excerpts"],
      retentionNotice: "Synthetic test configuration.",
      eligibility: "eligible",
      syntheticTest: true,
    };
    expect(disclosureSchema.safeParse({ configuration, decision: "none" }).success).toBe(true);
    for (const decision of ["none", "granted", "declined", "withdrawn"]) {
      expect(disclosureSchema.safeParse({ configuration, decision }).success).toBe(true);
    }
    for (const value of [
      { configuration: { ...configuration, categories: [] }, decision: "none" },
      { configuration: { ...configuration, eligibility: "unknown" }, decision: "none" },
      { configuration: { ...configuration, version: 0 }, decision: "none" },
      { configuration, decision: "pending" },
      { configuration, decision: "none", extra: true },
    ]) {
      expect(disclosureSchema.safeParse(value).success).toBe(false);
    }
  });
});
