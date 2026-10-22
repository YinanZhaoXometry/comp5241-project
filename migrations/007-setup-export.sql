-- Additive: durable personal-setup export requests plus the export artifact
-- lineage kind. Existing originals/revisions/receipts are retained untouched.
ALTER TABLE app.lifecycle_object DROP CONSTRAINT lifecycle_object_kind_check;
ALTER TABLE app.lifecycle_object ADD CHECK(kind IN ('original','extraction','selection','plan','export'));

-- Pinned name app.export_request with PK(owner_id, command_key); P6's deletion
-- fences enumerate this table by this name. `id` is the dedicated export
-- lifecycle root and the public request identity used by download URLs.
CREATE TABLE app.export_request (
  id uuid NOT NULL UNIQUE REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  command_key uuid NOT NULL,
  session_id uuid NOT NULL,
  epoch integer NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','ready','failed','expired','canceled')),
  failure_reason text CHECK (failure_reason IN ('resource','service')),
  manifest jsonb,
  manifest_hash text,
  artifact_object_id uuid UNIQUE REFERENCES app.lifecycle_object(id),
  artifact_key uuid UNIQUE,
  artifact_bytes integer CHECK (artifact_bytes>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  PRIMARY KEY(owner_id,command_key)
);
CREATE INDEX export_request_owner ON app.export_request(owner_id, created_at DESC);
CREATE INDEX export_request_sweep ON app.export_request(state) WHERE state IN ('queued','running','ready');
