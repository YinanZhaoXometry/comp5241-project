-- Additive epic-3 story 4 (content-plus-tests completion and monotonic parent
-- awards) schema. Story: "Content-plus-tests completion and monotonic parent
-- awards (3.4)"; write owner: src/modules/assessment-progress (its repository
-- is the ONLY writer of app.completion_award and app.studied_release). No
-- existing table rows change; idempotent guards as in 015–022 so a cancelled
-- run converges instead of failing.
--
-- No AI dispatch, no queue or worker change, no lifecycle-port change (entry
-- 3.9 registers awards in the deletion/export inventory): evaluation is pure
-- derivation over rows the modules already own — zero egress.
--
-- app.completion_award is the MONOTONIC award layer (AD-5/AD-8/D1):
-- a mini-course award row is INSERTED ONCE per (owner, course release, kind)
-- — ON CONFLICT DO NOTHING, no status column, no code path ever updates,
-- revokes or re-derives it; supersession, policy edits and later review
-- outcomes never touch an earned row. The row pins the awarded course release
-- (course_id CASCADE keeps root purge and whole-personal removal deleting
-- awards with the course lineage regardless of port ordering), its version and
-- the plan revision it was earned under; awarded_at records WHEN completion
-- was earned. kind 'parent-path' rows are the parent-manifest carriers (the
-- plan's "parent award INTENT rows", one table): they pin their required and
-- optional child RELEASES in manifest jsonb at plant time and carry NO
-- awarded_at until every required child release is awarded — the single
-- status-guarded transition sets awarded_at once and nothing ever clears it.
-- manifest_id is the parent release identity the partial UNIQUE index keys
-- on (the (owner, course_id, kind) UNIQUE covers mini-course rows; parent
-- rows have course_id NULL by the CHECK, so they cannot collide there).
--
-- app.studied_release is the explicit version-switch pointer (D1: learners
-- remain on their studied version until explicitly choosing another; the
-- switch verb alone upserts it). One row per (owner, root); course_id CASCADE
-- means a purged release returns the study to default (latest-ready)
-- resolution. The pointer is mutable learner choice — deliberately NOT part
-- of the award table, whose rows never change after insert.
CREATE TABLE IF NOT EXISTS app.completion_award (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  kind text NOT NULL CHECK (kind IN ('mini-course','parent-path')),
  course_id uuid REFERENCES app.generated_course(id) ON DELETE CASCADE,
  course_version integer CHECK (course_version IS NULL OR course_version >= 1),
  plan_revision_id uuid,
  manifest_id uuid,
  manifest jsonb,
  awarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (kind = 'mini-course' AND course_id IS NOT NULL AND course_version IS NOT NULL AND plan_revision_id IS NOT NULL AND manifest_id IS NULL AND manifest IS NULL AND awarded_at IS NOT NULL)
    OR
    (kind = 'parent-path' AND course_id IS NULL AND course_version IS NULL AND plan_revision_id IS NULL AND manifest_id IS NOT NULL AND jsonb_typeof(manifest) = 'object')
  ),
  UNIQUE (owner_id, course_id, kind)
);
-- One parent manifest row per (owner, manifest identity).
CREATE UNIQUE INDEX IF NOT EXISTS completion_award_manifest
  ON app.completion_award(owner_id, manifest_id) WHERE kind = 'parent-path';
CREATE INDEX IF NOT EXISTS completion_award_root ON app.completion_award(root_id, created_at DESC);
CREATE INDEX IF NOT EXISTS completion_award_owner ON app.completion_award(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS completion_award_course ON app.completion_award(course_id, created_at DESC);
CREATE TABLE IF NOT EXISTS app.studied_release (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  switched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, root_id)
);
