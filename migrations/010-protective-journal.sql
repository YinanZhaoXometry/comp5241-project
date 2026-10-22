-- Additive S13 protective-journal schema. No existing table changes. Applied
-- only by scripts/migrate.ts; runtime code appends rows and never alters this
-- DDL.
--
-- The journal independently records post-snapshot protective transitions
-- (root/personal deletions, consent withdrawals, session revocations) so a
-- restore of an older snapshot can reconcile everything that happened after
-- the snapshot was taken. It is content-free: IDs, versions, hashes and scope
-- labels only — never material, plan, answer or message text. The physical
-- independent copy is exported (and kept separately encrypted) by
-- scripts/backup.ts; this table is the durable in-database append log.
CREATE TABLE app.protective_journal (
  id uuid PRIMARY KEY,
  -- Total append order; backup records a cut through it and restore verifies
  -- completeness (contiguous 1..cut) before replaying anything.
  seq bigserial NOT NULL UNIQUE,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  -- Pinned event shape (v1). The last three types have no live producer module
  -- yet (blocked S6/S7-adjacent and later-epic concerns): they are appended and
  -- replayed only through explicit synthetic adapter fixtures whose replay is a
  -- recorded no-op — never a pretended feature implementation.
  event_type text NOT NULL CHECK (event_type IN (
    'deletion','consent-withdrawal','session-revocation',
    'role-revocation','enrollment-revocation','publication-withdrawal')),
  -- NULL owner_id marks a system-scope event (e.g. a restore procedure's mass
  -- session invalidation), matching the retention registry convention.
  owner_id uuid REFERENCES auth."user"(id),
  root_ids uuid[] NOT NULL DEFAULT '{}',
  object_ids uuid[] NOT NULL DEFAULT '{}',
  session_ids uuid[] NOT NULL DEFAULT '{}',
  -- Exactly the content-free fields replay needs to reconcile a restored
  -- pre-event snapshot (scope, command keys, disclosure versions, request
  -- hashes). Bounded so the journal can never become a shadow content store.
  receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (cardinality(root_ids) <= 1000
     AND cardinality(object_ids) <= 100000
     AND cardinality(session_ids) <= 10000
     AND pg_column_size(receipt) <= 4096)
);
CREATE INDEX protective_journal_recorded ON app.protective_journal(recorded_at);

-- Append-only enforcement independent of grants: the migration owner grants
-- UPDATE/DELETE on all app tables to the runtime role, so the table itself
-- must refuse every mutation and truncation. Restore imports rows as INSERTs,
-- which stays permitted.
CREATE FUNCTION app.protective_journal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.protective_journal is append-only';
END $$;
CREATE TRIGGER protective_journal_no_update BEFORE UPDATE OR DELETE ON app.protective_journal
  FOR EACH ROW EXECUTE FUNCTION app.protective_journal_append_only();
CREATE TRIGGER protective_journal_no_truncate BEFORE TRUNCATE ON app.protective_journal
  FOR EACH STATEMENT EXECUTE FUNCTION app.protective_journal_append_only();
