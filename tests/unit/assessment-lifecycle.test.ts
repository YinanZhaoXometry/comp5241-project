import { expect, it } from "vitest";
import { registeredPorts } from "../../src/modules/lifecycle-platform/derivatives";
import { RETENTION_CLASSES, RETENTION_CLASS_KEYS, requireRetentionClass } from "../../src/modules/lifecycle-platform/retention";
import {
  exportCategories,
  exportCategoryLabels,
  lifecycleCategories,
} from "../../src/contracts/export";
import { ASSESSMENT_GENERATION_USE_SKIP, jsonSafe } from "../../src/modules/setup-export/manifest";

// Epic-3 story 3.9 — the lifecycle/ownership/deletion integration's pure
// surface: the registered port contract, the export category contracts, the
// honest skip phrasing, the retention coverage decision (executable record)
// and the payload date mapping. The DB-bound halves (preview counts, purge
// completeness, races, export content, cross-owner denial) are covered by
// tests/integration/assessment-lifecycle.test.ts, authored to run in the
// orchestrator's serialized DB phase.

// The deletion inventory knows every assessment derivative kind: the port is
// registered with the coordinator, carries all three S9 operations and an
// honest label — the course-generation/instructor-courses registration shape.
it("registers the assessment-progress lifecycle port with preview, deny and purge", () => {
  const port = registeredPorts().find(candidate => candidate.name === "assessment-progress");
  expect(port).toBeDefined();
  expect(typeof port!.preview).toBe("function");
  expect(typeof port!.deny).toBe("function");
  expect(typeof port!.purge).toBe("function");
  expect(port!.label).toBe("Scored assessment evidence");
  // The established ports stay registered alongside it — registration is
  // additive, never a replacement (the epic-5 instructor-courses port is a
  // parallel lane not on this branch).
  const names = registeredPorts().map(candidate => candidate.name);
  for (const established of ["setup-export", "setup-diagnostic", "ai-setup", "course-generation"])
    expect(names).toContain(established);
});

// The export contract surface: assessment history is ONE captured category
// (the diagnostic-evidence one-category precedent) plus ONE deliberate skip
// for the content-free counter; assessment entries are never lifecycle
// objects, so the artifact's recursive parent fence must not gain them.
it("adds exactly the two assessment export categories with honest labels", () => {
  expect(exportCategories.filter(category => category === "assessment-evidence")).toHaveLength(1);
  expect(exportCategories.filter(category => category === "assessment-generation-use")).toHaveLength(1);
  expect(exportCategoryLabels["assessment-evidence"]).toContain("Scored assessment history");
  // The label names what ships — attempts, recovery, awards, disputes — so
  // the pre-request preview cannot over- or under-claim.
  for (const word of ["attempts", "recovery", "awards", "disputes"])
    expect(exportCategoryLabels["assessment-evidence"]).toContain(word);
  expect(exportCategoryLabels["assessment-generation-use"]).toContain("content-free");
});

it("keeps assessment entries out of the lifecycle manifest parents", () => {
  expect(lifecycleCategories).not.toContain("assessment-evidence");
  expect(lifecycleCategories).not.toContain("assessment-generation-use");
  // The fence set itself is unchanged: only the four epic-1 object classes.
  expect([...lifecycleCategories]).toEqual(["originals", "extractions", "selections", "plans"]);
});

// The honest-exclusion contract (the epic-2 supplements/ai-drafts pattern):
// the skip names the class, states the exclusion is deliberate, says WHY
// (content-free accounting, not study content) and points at where the
// counted evidence does ship.
it("records the generation-counter skip with its honest reason", () => {
  expect(ASSESSMENT_GENERATION_USE_SKIP).toContain("Deliberately excluded");
  expect(ASSESSMENT_GENERATION_USE_SKIP).toContain("content-free");
  expect(ASSESSMENT_GENERATION_USE_SKIP).toContain("not study content");
  expect(ASSESSMENT_GENERATION_USE_SKIP).toContain("assessment-evidence");
  // It never claims the counter is study content and never promises the
  // artifact carries it.
  expect(ASSESSMENT_GENERATION_USE_SKIP.toLowerCase()).not.toContain("unlimited");
});

// The executable record of the retention coverage decision (the epic-2
// entry-8 resolution): assessment derivatives ride the SEVEN-DAY deletion
// clock through the registered port — the deadline class every accepted
// deletion already records in the registry — so no assessment-specific
// class member exists or is needed. If someone later adds one, this pin and
// the migration-CHECK parity test in retention.test.ts force the full
// class+CHECK+migration decision instead of a silent half.
it("covers assessment derivative purge under the seven-day deletion clock with no new retention class", () => {
  const purgeClock = requireRetentionClass("deletion-active-purge");
  expect(purgeClock.days).toBe(7);
  expect(purgeClock.note).toContain("deletion reconciler");
  const assessmentClasses = RETENTION_CLASS_KEYS.filter(key => key.includes("assessment"));
  expect(assessmentClasses).toEqual([]);
  // The registry classes are otherwise untouched by this story.
  expect(Object.keys(RETENTION_CLASSES).sort()).toEqual(
    ["export-artifact", "deletion-active-purge", "metadata-receipt", "backup-snapshot", "protective-journal", "course-archive"].sort(),
  );
});

// jsonb does not serialize Date objects: every assessment payload row passes
// through this mapping so timestamps land as ISO strings at any depth.
it("maps dates to ISO strings at any depth and leaves other values untouched", () => {
  const stamp = new Date("2026-10-29T00:00:00.000Z");
  const mapped = jsonSafe({
    created_at: stamp,
    graded_at: null,
    points: 1999,
    nested: [{ resolved_at: stamp }, { snapshot: { items: [{ opened_at: stamp }] } }],
  }) as Record<string, unknown>;
  expect(mapped.created_at).toBe("2026-10-29T00:00:00.000Z");
  expect(mapped.graded_at).toBeNull();
  expect(mapped.points).toBe(1999);
  const nested = mapped.nested as Array<Record<string, unknown>>;
  expect(nested[0].resolved_at).toBe("2026-10-29T00:00:00.000Z");
  const inner = (nested[1].snapshot as { items: Array<{ opened_at: unknown }> }).items[0];
  expect(inner.opened_at).toBe("2026-10-29T00:00:00.000Z");
  expect(jsonSafe([stamp])).toEqual(["2026-10-29T00:00:00.000Z"]);
});
