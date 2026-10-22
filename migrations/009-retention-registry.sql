-- Additive S10 bounded-retention state: the explicit active-copy registry and
-- the ninety-day course-archive contract. Existing roots/objects, export
-- requests, deletion requests/preview journals and receipts are untouched;
-- registry rows only reference them and never hold content. The registry is
-- applied by scripts/migrate.ts only; runtime code may read/write rows but
-- never alter this DDL.
CREATE TABLE app.retention_registry (
  id uuid PRIMARY KEY,
  -- NULL owner_id marks a system-scope copy (e.g. S13's whole-snapshot classes).
  owner_id uuid REFERENCES auth."user"(id),
  -- Free identifier of the copy's store, chosen by the registering module
  -- (e.g. 'export-request', 'deletion-request', 'course-archive').
  kind text NOT NULL,
  -- The bounded retention class. 'backup-snapshot' and 'protective-journal'
  -- are registered here for S13's physical implementation; no backup or
  -- journal exists in this story and class configuration alone is not backup
  -- evidence.
  retention_class text NOT NULL CHECK (retention_class IN (
    'export-artifact','deletion-active-purge','metadata-receipt',
    'backup-snapshot','protective-journal','course-archive')),
  -- Exactly one physical/logical locator per row: a private-storage key and/or
  -- a content-free table/row pointer. No material, plan or answer text.
  storage_key uuid,
  table_name text,
  row_id text,
  CHECK (storage_key IS NOT NULL OR (table_name IS NOT NULL AND row_id IS NOT NULL)),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','purged')),
  -- When the copy must be gone. Overdue status/alerts are derived from this
  -- column; alerts never restore access.
  expires_at timestamptz NOT NULL,
  alerted_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One registry row per copy: duplicate scheduler runs and duplicate
-- registrations are idempotent, and a purged row is never resurrected by a
-- late re-registration (the guarded upsert in lifecycle-platform/retention.ts
-- only refreshes still-active rows).
CREATE UNIQUE INDEX retention_registry_copy ON app.retention_registry (
  kind, COALESCE(storage_key::text, table_name || '#' || row_id)
);
CREATE INDEX retention_registry_due ON app.retention_registry(state, expires_at);

-- Ninety-day post-archive notice/export/purge contract. The source check
-- admits only synthetic course-controller fixture rows: this table establishes
-- the contract interface that consumer epics extend and retest with their real
-- integrations. It provides no instructor enrollment/authoring integration and
-- must not be presented as one.
CREATE TABLE app.archive_contract (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_controller text NOT NULL,
  source text NOT NULL CHECK (source IN ('synthetic-fixture')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','notice','exported')),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Notice at sixty days, purge at ninety days; notice is recorded before any
  -- purge may run and the export window is learner-initiated in between.
  notice_due_at timestamptz NOT NULL,
  purge_due_at timestamptz NOT NULL,
  CHECK (notice_due_at < purge_due_at),
  noticed_at timestamptz,
  exported_at timestamptz,
  export_receipt jsonb
);
CREATE INDEX archive_contract_owner ON app.archive_contract(owner_id);
