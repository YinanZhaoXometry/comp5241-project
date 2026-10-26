-- Additive epic-2 S2 (bounded source retrieval and attributed supplementation)
-- schema. No existing table rows change; idempotent guards as in 012/015 so a
-- cancelled run converges instead of failing.
--
-- Configuration v6 widens the consented purpose CUMULATIVELY to cover the
-- supplement pass's proposal input: gap descriptions from the confirmed plan
-- and generated-lesson summaries join the consented categories. Existing v5
-- grants honestly lapse; one owner re-grant gates the supplement pass (and,
-- because the purpose is shared, course generation re-grants under v6 too).
-- The processor behind v6 remains the LOCAL SYNTHETIC FIXTURE (the proposal
-- completion); external source FETCH admission stays deferred to feasibility
-- gate F-B — no live fetch happens under this version, and no source-licensing,
-- rate-limit or egress-scope claim is made anywhere.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000006',6,
  'Local synthetic generation fixture (no external dispatch; live admissions deferred to F-A/F-B)',
  'Setup assistance and mini-course generation: topic inference, study-plan drafting, optional starting-check items, source-linked mini-course lessons from the confirmed plan, and public-source supplement proposals for declared plan gaps',
  '["selected source excerpts","stated goal and topic","confirmed plan outcomes","confirmed plan mini-course outline","gap descriptions","generated lesson summaries"]'::jsonb,
  'Local synthetic fixture only in this version: supplement proposals run on this machine and send nothing to any external provider, and source fetch runs on deterministic local fixtures with zero network egress. Live processor admission is deferred to gate F-A and live source fetch to gate F-B; no compliance or live-dispatch claim is made.',
  'eligible',true,20
) ON CONFLICT (version) DO NOTHING;

-- Lifecycle kind CHECK extended with 'supplement' (the 011/015 rebuild
-- precedent): verified supplements are derivative lifecycle objects parented
-- to the generated course they explain, so recursive ancestor fences and
-- transitive invalidation cover supplement reads exactly like every
-- derivative.
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
      CHECK (kind IN ('original','extraction','selection','plan','diagnostic','export','course','supplement'));
  END IF;
END
$$;

-- One tracked supplement pass per command, pinned to ONE ready course
-- version. Statuses are terminal monotonic from 'pending'; status-guarded
-- updates keep duplicate deliveries no-ops. ON DELETE CASCADE from
-- generated_course mirrors the course lineage: root purge deletes the
-- request (and its rows below) with the course regardless of port ordering.
CREATE TABLE IF NOT EXISTS app.supplement_request (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES app.dispatch_admission(id),
  object_id uuid REFERENCES app.lifecycle_object(id),
  status text NOT NULL CHECK (status IN ('pending','ready','failed')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz
);
-- One tracked result per command (admission is single-use); retry after an
-- honest failure inserts a fresh row under a fresh admission.
CREATE UNIQUE INDEX IF NOT EXISTS supplement_request_admission ON app.supplement_request(admission_id);
CREATE INDEX IF NOT EXISTS supplement_request_course ON app.supplement_request(course_id,created_at DESC);
CREATE INDEX IF NOT EXISTS supplement_request_root ON app.supplement_request(root_id,created_at DESC);
CREATE INDEX IF NOT EXISTS supplement_request_owner ON app.supplement_request(owner_id,created_at DESC);

-- Verified supplement rows, one per declared plan gap per request (position =
-- gap index). Rows exist only on definite checked outcomes, never after a
-- fetch failure: 'supported'/'conflict' carry the verified passage, its
-- locator inside the fetched content, the fetched content hash and the
-- retrieval time; 'unsupported' records honestly that the claimed passage
-- was checked against the fetched source and NOT found, persisting no
-- content. A conflict keeps both sides — the upload excerpt the candidate
-- spoke to and the fetched passage — for side-by-side display, never a
-- silent resolution.
CREATE TABLE IF NOT EXISTS app.course_supplement (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES app.supplement_request(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  outcome text NOT NULL CHECK (outcome IN ('supported','conflict','unsupported')),
  url text NOT NULL,
  origin text NOT NULL,
  locator text,
  passage text,
  content_hash text,
  retrieved_at timestamptz,
  claim text NOT NULL,
  upload_excerpt text,
  upload_source text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, position),
  CHECK (
    (outcome IN ('supported','conflict') AND locator IS NOT NULL AND passage IS NOT NULL AND content_hash IS NOT NULL AND retrieved_at IS NOT NULL)
    OR
    (outcome = 'unsupported' AND locator IS NULL AND passage IS NULL AND content_hash IS NULL AND retrieved_at IS NOT NULL)
  ),
  CHECK (
    (outcome = 'conflict' AND upload_excerpt IS NOT NULL AND upload_source IS NOT NULL)
    OR
    (outcome <> 'conflict' AND upload_excerpt IS NULL AND upload_source IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS course_supplement_course ON app.course_supplement(course_id,position);
