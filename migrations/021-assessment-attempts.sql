-- Additive epic-3 story 1 (plan-to-roadmap scored-attempt tracer) schema.
-- Story: "Plan-to-roadmap scored-attempt tracer (3.1)"; write owner:
-- src/modules/assessment-progress (its repository is the ONLY writer of
-- app.test_attempt). No existing table rows change; idempotent guards as in
-- 015–020 so a cancelled run converges instead of failing.
--
-- No new processor_configuration version, queue or worker change: the test is
-- synthetic DERIVATION from the course the learner already owns (the 017/019
-- precedent) — zero AI dispatch, zero egress, nothing new leaves the machine.
--
-- One row per scored attempt: the blueprint, questions, answer key, declared
-- answer rules, rubric, point scale and pass mark are SNAPSHOTTED at start
-- (D3/AD-8 attempt integrity); grading reads only the snapshot, so superseding
-- the course version mid-attempt never changes a verdict (AD-5). The row is
-- submitted exactly once — statuses are terminal-monotonic from 'active', the
-- single status-guarded UPDATE in the repository lands the whole graded state
-- (answers, unrounded integer points, pass flag, timestamp) atomically or
-- nothing — and previous attempts are never overwritten, only listed. The
-- partial UNIQUE index makes "one open attempt per (owner, root)" structural:
-- a repeat start returns the pinned open attempt, a retake follows a graded
-- row. The learner's answers live in their own jsonb column (an array, stored
-- as JSON text explicitly) so the snapshot stays the immutable at-start pin.
-- ON DELETE CASCADE from generated_course keeps root purge and whole-personal
-- removal deleting attempts with the course lineage regardless of port
-- ordering; the roadmap node is DERIVED (required items done + passed attempt
-- on the current version) — there are deliberately no award rows here.
CREATE TABLE IF NOT EXISTS app.test_attempt (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  course_version integer NOT NULL CHECK (course_version >= 1),
  plan_revision_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active','graded')),
  snapshot jsonb NOT NULL,
  answers jsonb,
  earned_points integer,
  total_points integer,
  passed boolean,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  graded_at timestamptz,
  CHECK (
    (status = 'active' AND answers IS NULL AND earned_points IS NULL AND total_points IS NULL AND passed IS NULL AND graded_at IS NULL)
    OR
    (status = 'graded' AND jsonb_typeof(answers) = 'array' AND earned_points IS NOT NULL AND earned_points >= 0 AND total_points IS NOT NULL AND total_points > 0 AND passed IS NOT NULL AND graded_at IS NOT NULL)
  )
);
-- One open attempt per owner and study root (retakes follow a graded row).
CREATE UNIQUE INDEX IF NOT EXISTS test_attempt_open
  ON app.test_attempt(owner_id, root_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS test_attempt_root ON app.test_attempt(root_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_attempt_owner ON app.test_attempt(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_attempt_course ON app.test_attempt(course_id, created_at DESC);
