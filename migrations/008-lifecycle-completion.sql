-- Additive protective state for S9: whole-personal deletion requests and the
-- content-free dependency-preview journal. Existing roots/objects/receipts and
-- the root-scoped deletion path are untouched. Categories are counts only;
-- no raw material, plan or answer text is ever stored here.
CREATE TABLE app.deletion_request (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  command_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','purged')),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Seven-day active-copy purge deadline (S10's scheduler enforces/alerts;
  -- this column makes the deadline durably visible from acceptance).
  deadline_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
  purged_at timestamptz,
  categories jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX deletion_request_owner ON app.deletion_request(owner_id);

-- Journal of accepted deletion previews (scope + category counts only, no
-- content). Expires within thirty days per AD-4; P7's retention sweep owns expiry.
CREATE TABLE app.deletion_preview (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  root_id uuid REFERENCES app.lifecycle_root(id),
  scope text NOT NULL CHECK (scope IN ('root','personal')),
  categories jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 days'
);
CREATE INDEX deletion_preview_owner ON app.deletion_preview(owner_id,created_at);
