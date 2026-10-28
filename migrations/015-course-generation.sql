-- Additive epic-2 S1 (confirmed-plan-to-generated-course tracer) schema. No
-- existing table rows change; idempotent guards as in 012/014 so a cancelled
-- run converges instead of failing.
--
-- Configuration v5 widens the consented purpose to cover mini-course
-- generation. The purpose is CUMULATIVE (it keeps every setup-assistance
-- wording of v4) so S6/S7 grants do not silently keep dispatching under a
-- narrower disclosure; existing v4 grants honestly lapse and one owner
-- re-grant gates generation. v5's admitted basis is the LOCAL SYNTHETIC
-- FIXTURE recorded by the entry's gate decision (2026-10-26): no external
-- dispatch happens under this version, and live provider admission stays
-- deferred to feasibility gate F-A. No D5-compliance, F3-passed,
-- non-training, retention or deletion claim is made anywhere.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000005',5,
  'Local synthetic generation fixture (no external dispatch; live admission deferred to F-A)',
  'Setup assistance and mini-course generation: topic inference, study-plan drafting, optional starting-check items, and source-linked mini-course lessons from the confirmed plan',
  '["selected source excerpts","stated goal and topic","confirmed plan outcomes","confirmed plan mini-course outline"]'::jsonb,
  'Local synthetic fixture only in this version: mini-course generation runs on this machine and sends nothing to any external provider. Live processor admission is deferred to gate F-A; no compliance or live-dispatch claim is made.',
  'eligible',true,20
) ON CONFLICT (version) DO NOTHING;

-- Lifecycle kind CHECK extended with 'course' (the 011 additive-rebuild
-- precedent): generated courses are derivative lifecycle objects parented to
-- the exact confirmed plan revision, so recursive ancestor fences and
-- transitive invalidation cover course reads exactly like every derivative.
ALTER TABLE app.lifecycle_object DROP CONSTRAINT IF EXISTS lifecycle_object_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lifecycle_object_kind_check'
      AND conrelid = 'app.lifecycle_object'::regclass
  ) THEN
    ALTER TABLE app.lifecycle_object
      ADD CONSTRAINT lifecycle_object_kind_check
      CHECK (kind IN ('original','extraction','selection','plan','diagnostic','export','course'));
  END IF;
END
$$;

-- One tracked generation per command. The row holds the settled course
-- document (lesson sections with resolved source refs, objectives and the
-- recall item whose canonical answer exists ONLY here and in submission
-- feedback), model provenance and provider-claimed usage. Statuses are
-- terminal monotonic from 'pending'; status-guarded updates keep duplicate
-- deliveries no-ops. ON DELETE CASCADE from plan/selection revisions mirrors
-- the diagnostic tables: root purge deletes the derivative with its lineage
-- regardless of port ordering.
CREATE TABLE IF NOT EXISTS app.generated_course (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  plan_revision_id uuid NOT NULL REFERENCES app.plan_revision(id) ON DELETE CASCADE,
  selection_id uuid NOT NULL REFERENCES app.selection_revision(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES app.dispatch_admission(id),
  object_id uuid REFERENCES app.lifecycle_object(id),
  status text NOT NULL CHECK (status IN ('pending','ready','failed')),
  failure_code text,
  version integer CHECK (version IS NULL OR version >= 1),
  superseded_by uuid REFERENCES app.generated_course(id),
  content jsonb,
  model text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz
);
-- One tracked result per command (admission is single-use) and exactly one
-- ready course per (root, confirmed plan revision); retries after an honest
-- failure insert a fresh row under a fresh admission.
CREATE UNIQUE INDEX IF NOT EXISTS generated_course_admission ON app.generated_course(admission_id);
CREATE UNIQUE INDEX IF NOT EXISTS generated_course_ready_plan ON app.generated_course(root_id,plan_revision_id) WHERE status='ready';
CREATE INDEX IF NOT EXISTS generated_course_root ON app.generated_course(root_id,created_at DESC);
CREATE INDEX IF NOT EXISTS generated_course_owner ON app.generated_course(owner_id,created_at DESC);

-- Versioned objective/source lineage for later entries' authorized query
-- surface (entry 7); the served course view reads the settled content.
CREATE TABLE IF NOT EXISTS app.course_objective (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  objective text NOT NULL,
  UNIQUE (course_id, position)
);
CREATE TABLE IF NOT EXISTS app.course_source (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  extraction_id uuid NOT NULL REFERENCES app.extraction_revision(id) ON DELETE CASCADE,
  filename text NOT NULL,
  UNIQUE (course_id, position)
);
