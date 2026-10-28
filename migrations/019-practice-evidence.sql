-- Additive epic-2 S5 (active recall practice set and typed feedback) schema.
-- No existing table rows change; idempotent guards as in 015/016/017 so a
-- cancelled run converges instead of failing.
--
-- No new processor_configuration version: the 2.5 gate decision (2026-10-27)
-- records that v7's purpose/categories already cover the practice set — it
-- derives from the same consented categories (plan outcomes, source excerpts)
-- and nothing new leaves the machine, so re-grant machinery is untouched.
--
-- Typed practice evidence, deliberately WITHOUT attempt semantics: one row per
-- submission event (owner, course version, card id, attempted text, outcome,
-- learner-declared evidence kind, submitted time). There are deliberately NO
-- score, credit, completion, course-attempt or scheduling columns anywhere —
-- epics 3/4 own those. Retries are FRESH rows under new commands (never
-- deduplicated, never double-counted as anything); command-envelope replay of
-- the SAME command is guarded by the EXISTING app.command_receipt machinery
-- (service-layer lifecycle.replay/receipt), which is why this table carries no
-- UNIQUE constraint. Card ids follow the tracker pattern
-- ('practice:<objectiveIndex>'); no uuid surface enters URLs. ON DELETE
-- CASCADE from generated_course mirrors the tracker tables: root purge and
-- whole-personal removal delete practice evidence with the course lineage
-- regardless of port ordering.
CREATE TABLE IF NOT EXISTS app.practice_attempt (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  card_id text NOT NULL CHECK (card_id ~ '^practice:[0-7]$'),
  attempted text NOT NULL CHECK (length(trim(attempted)) > 0 AND length(attempted) <= 2000),
  outcome text NOT NULL CHECK (outcome IN ('correct','incorrect')),
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('unaided','assisted')),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS practice_attempt_owner ON app.practice_attempt(owner_id,submitted_at DESC);
CREATE INDEX IF NOT EXISTS practice_attempt_course ON app.practice_attempt(course_id,submitted_at DESC);
