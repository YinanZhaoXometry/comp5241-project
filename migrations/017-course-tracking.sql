-- Additive epic-2 S3 (mini-course player shell and content-item tracking)
-- schema. No existing table rows change; idempotent guards as in 015/016 so a
-- cancelled run converges instead of failing.
--
-- No new processor_configuration version: the 2.3 gate decision (2026-10-27)
-- records that v6's purpose/categories already cover multi-lesson generation
-- from the confirmed plan — no new data leaves the machine and the synthetic
-- fixture stays the only processor, so re-grant machinery is untouched.
--
-- Explicit content-item tracking is owner-scoped, course-version-scoped state:
-- one row per (owner, ready course version, tracker item id) recording ONLY an
-- explicit learner mark-done. There are deliberately no score, credit,
-- completion, dwell, scroll or visibility columns anywhere — done is an
-- explicit action, never an inference. Item ids are the stable strings the
-- content contract derives (e.g. 'lesson:2:reading', 'enrichment:1'); no uuid
-- surface enters URLs. Command-envelope replay rides the EXISTING
-- app.command_receipt machinery (service-layer lifecycle.replay/receipt) — no
-- new receipt table. ON DELETE CASCADE from generated_course mirrors the
-- derivative tables: root purge and whole-personal removal delete tracker rows
-- with the course lineage regardless of port ordering.
CREATE TABLE IF NOT EXISTS app.course_item_state (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  item_id text NOT NULL CHECK (item_id ~ '^(lesson:[1-8]:reading|enrichment:[1-8])$'),
  done_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, course_id, item_id)
);
CREATE INDEX IF NOT EXISTS course_item_state_owner ON app.course_item_state(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS course_item_state_course ON app.course_item_state(course_id);
