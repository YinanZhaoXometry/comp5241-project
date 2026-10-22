-- Additive setup-diagnostic infrastructure (S7 infrastructure subset; story 7).
-- Bundle ids are lifecycle objects (kind 'diagnostic') parented to the exact
-- confirmed plan revision, so the existing recursive ancestor fences and
-- transitive invalidation cover check use without new fence logic. Tables are
-- pinned by name for the S8 export inventory and S9 delete preview.
ALTER TABLE app.lifecycle_object DROP CONSTRAINT lifecycle_object_kind_check;
ALTER TABLE app.lifecycle_object ADD CHECK(kind IN ('original','extraction','selection','plan','diagnostic'));

CREATE TABLE app.diagnostic_bundle (
  id uuid PRIMARY KEY REFERENCES app.lifecycle_object(id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  plan_id uuid NOT NULL REFERENCES app.plan_revision(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('manual-synthetic')),
  item_count integer NOT NULL CHECK (item_count >= 3 AND item_count <= 5),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One declared bundle per confirmed plan revision; a later confirmation pins a new one.
CREATE UNIQUE INDEX diagnostic_bundle_plan ON app.diagnostic_bundle(plan_id);
CREATE INDEX diagnostic_bundle_root ON app.diagnostic_bundle(root_id);
CREATE TRIGGER immutable_diagnostic_bundle BEFORE UPDATE ON app.diagnostic_bundle FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();

CREATE TABLE app.diagnostic_item (
  id uuid PRIMARY KEY,
  bundle_id uuid NOT NULL REFERENCES app.diagnostic_bundle(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5),
  objective text NOT NULL,
  source_ref text NOT NULL,
  prompt text NOT NULL,
  choices jsonb NOT NULL,
  answer_id text NOT NULL,
  rationale text NOT NULL,
  UNIQUE(bundle_id, position)
);
CREATE TRIGGER immutable_diagnostic_item BEFORE UPDATE ON app.diagnostic_item FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();

-- Typed per-item evidence: actor/scope/pinned revision, assistance, objective
-- and source, one row per bundle item. choice_id NULL records an item skipped
-- before answering; outcome 'unknown' is the only unanswered state. There are
-- deliberately no score, grade, completion, recovery or credit columns, and
-- evidence rows are immutable except the single-direction unclear flag.
CREATE TABLE app.diagnostic_evidence (
  id uuid PRIMARY KEY,
  bundle_id uuid NOT NULL REFERENCES app.diagnostic_bundle(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES app.diagnostic_item(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  plan_id uuid NOT NULL REFERENCES app.plan_revision(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5),
  choice_id text,
  outcome text NOT NULL CHECK (outcome IN ('correct','incorrect','unknown')),
  assistance text NOT NULL CHECK (assistance IN ('unaided','assisted')),
  unclear boolean NOT NULL DEFAULT false,
  path text NOT NULL CHECK (path IN ('item-submit','item-skip')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(bundle_id, item_id)
);
CREATE INDEX diagnostic_evidence_owner ON app.diagnostic_evidence(owner_id);
