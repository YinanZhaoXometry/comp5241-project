-- Additive epic-2 S6 (learner-controlled why exploration with honest stopping)
-- schema. No existing table rows change; idempotent guards as in 015–019 so a
-- cancelled run converges instead of failing.
--
-- No new processor_configuration version: the 2.6 gate decision (2026-10-27)
-- records that v7's purpose/categories already cover why explanations — they
-- consume the same consented categories (lesson summaries, source excerpts,
-- verified supplements) and nothing new leaves the machine, so re-grant
-- machinery is untouched.
--
-- One why-explanation derivative row per (owner, course version, lesson index,
-- depth). The row is the single durable record of ONE tracked command
-- (statuses terminal-monotonic from 'pending'; claim-first transitions in the
-- worker) AND of its settled result: explanation text, resolved visible-source
-- citations and model provenance exist only at 'ready'. The
-- UNIQUE(owner, course, lesson, depth) makes "one explanation per level"
-- structural — a repeat command replays the settled row, a
-- regenerate-after-supersede lands on the NEW course version's own rows, and
-- an honest retry after failure re-pends the same row under a fresh admission.
-- Depth NEVER unlocks anything: there are deliberately no tracker, credit,
-- completion, score or content columns, and ON DELETE CASCADE from
-- generated_course keeps root purge and whole-personal removal deleting why
-- rows with the course lineage regardless of port ordering. No new
-- lifecycle_object kind: the rows fence on the course's own lifecycle objects
-- exactly like the practice evidence (019) — the deletion preview counts them
-- as their own category under the course-generation port.
CREATE TABLE IF NOT EXISTS app.why_explanation (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  lesson_index integer NOT NULL CHECK (lesson_index BETWEEN 0 AND 7),
  depth integer NOT NULL CHECK (depth BETWEEN 1 AND 2),
  admission_id uuid NOT NULL REFERENCES app.dispatch_admission(id),
  status text NOT NULL CHECK (status IN ('pending','ready','failed')),
  failure_code text,
  dimension text CHECK (dimension IN ('purpose','assumptions-trade-offs')),
  explanation text,
  sources jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  UNIQUE (owner_id, course_id, lesson_index, depth),
  CHECK (
    (status IN ('pending','failed') AND dimension IS NULL AND explanation IS NULL AND sources IS NULL AND model IS NULL)
    OR
    (status = 'ready' AND dimension IS NOT NULL AND explanation IS NOT NULL AND sources IS NOT NULL AND model IS NOT NULL AND jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) >= 1)
  )
);
-- One tracked result per command (admission is single-use); a retry after an
-- honest failure re-pends the row under a fresh admission.
CREATE UNIQUE INDEX IF NOT EXISTS why_explanation_admission ON app.why_explanation(admission_id);
CREATE INDEX IF NOT EXISTS why_explanation_course ON app.why_explanation(course_id,lesson_index,depth);
CREATE INDEX IF NOT EXISTS why_explanation_root ON app.why_explanation(root_id,created_at DESC);
CREATE INDEX IF NOT EXISTS why_explanation_owner ON app.why_explanation(owner_id,created_at DESC);
