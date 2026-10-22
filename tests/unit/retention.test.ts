import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ARCHIVE_NOTICE_DAYS,
  ARCHIVE_PURGE_DAYS,
  RECEIPT_RETENTION_DAYS,
  RETENTION_CLASS_KEYS,
  requireRetentionClass,
} from "../../src/modules/lifecycle-platform/retention";
import { errorCode } from "../../src/platform/errors";

// The retention classes are the refuse-unregistered-derivative contract: the
// set that gates persistence in code must equal the set the database CHECK
// enforces in migration 009, or a registration that passes code would fail at
// the database (or worse, silently diverge).
it("keeps the code-side retention class set identical to the migration CHECK", async () => {
  const migration = await readFile("migrations/009-retention-registry.sql", "utf8");
  const check = migration.match(/retention_class text NOT NULL CHECK \(retention_class IN \(([^)]*)\)/u);
  expect(check).not.toBeNull();
  const sqlClasses = (check![1] ?? "").split(",").map((value) => value.trim().replaceAll("'", ""));
  expect([...sqlClasses].sort()).toEqual([...RETENTION_CLASS_KEYS].sort());
});

it("pins the bounded retention ceilings: 24h exports, 7d purge deadline, 30d receipts/backups/journals, 90d archive", () => {
  expect(requireRetentionClass("export-artifact").days).toBe(1);
  expect(requireRetentionClass("deletion-active-purge").days).toBe(7);
  expect(requireRetentionClass("metadata-receipt").days).toBe(30);
  expect(requireRetentionClass("backup-snapshot").days).toBe(30);
  expect(requireRetentionClass("protective-journal").days).toBe(30);
  expect(requireRetentionClass("course-archive").days).toBe(90);
  expect(ARCHIVE_NOTICE_DAYS).toBe(60);
  expect(ARCHIVE_PURGE_DAYS).toBe(90);
  expect(RECEIPT_RETENTION_DAYS).toBe(30);
  expect(ARCHIVE_NOTICE_DAYS).toBeLessThan(ARCHIVE_PURGE_DAYS);
});

it("refuses persistence for an unregistered retention class", () => {
  try {
    requireRetentionClass("course-media-future");
    throw new Error("Unregistered class must be refused");
  } catch (error) {
    expect(errorCode(error)).toBe("INVALID_INPUT");
  }
  expect(requireRetentionClass("export-artifact").label).toContain("export");
});
