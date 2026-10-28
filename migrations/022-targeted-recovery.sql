-- Additive epic-3 story 2 (targeted recovery ledger and fresh retest chain)
-- schema. Story: "Targeted recovery ledger and fresh retest chain (3.2)";
-- write owner: src/modules/assessment-progress (its repository is the ONLY
-- writer of app.retest_attempt and app.recovery_target). Migration 021's
-- app.test_attempt rows and CHECK are untouched — graded ordinary rows stay
-- immutable and the original score is never rewritten; idempotent guards as
-- in 015–021 so a cancelled run converges instead of failing.
--
-- No AI dispatch, no queue or worker change: retests assemble from the same
-- manually checked synthetic bank module (the 017/019/021 precedent) — zero
-- egress, nothing new leaves the machine.
--
-- app.retest_attempt is created FIRST because app.recovery_target.cleared_by
-- references it. The retest mirrors test_attempt's exactly-once shape but
-- grades PER OBJECTIVE GROUP: there is deliberately no overall earned/total/
-- passed triple — group_results jsonb carries the per-group earned/total/
-- cleared records, and a target group clears only when it independently
-- reaches the ROOT attempt's snapshotted pass mark (AD-8 targeted credit).
-- The retest pins the ROOT attempt's course/version/plan revision: recovery
-- stays pinned to the root attempt's course version even when a newer ready
-- version supersedes it mid-chain. target_objective_indexes jsonb is the
-- declared non-empty subset of open targets the retest covers. The partial
-- UNIQUE index makes "one open retest per root attempt" structural.
--
-- app.recovery_target is the per-objective-group ledger written in the SAME
-- transaction as the failed ordinary grade: every failed group lands OPEN
-- with its initial (under-that-attempt's-own-snapshot) earned/total; passing
-- groups are never ledgered and never re-tested (D3/AD-8). UNIQUE
-- (root_attempt_id, objective_index) keeps one target per group per root.
-- The open -> cleared transition is status-guarded in the repository and
-- records which retest cleared it and when. ON DELETE CASCADE from both
-- test_attempt and generated_course keeps root purge and whole-personal
-- removal deleting the whole chain with the course lineage regardless of
-- port ordering. The failed-test requirement is satisfied only when every
-- target of that ledger reads cleared — no missing/untested target is ever
-- inferred passed.
CREATE TABLE IF NOT EXISTS app.retest_attempt (
  id uuid PRIMARY KEY,
  root_attempt_id uuid NOT NULL REFERENCES app.test_attempt(id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  course_version integer NOT NULL CHECK (course_version >= 1),
  plan_revision_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active','graded')),
  target_objective_indexes jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  answers jsonb,
  group_results jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  graded_at timestamptz,
  CHECK (
    (status = 'active' AND answers IS NULL AND group_results IS NULL AND graded_at IS NULL)
    OR
    (status = 'graded' AND jsonb_typeof(answers) = 'array' AND jsonb_typeof(group_results) = 'array' AND graded_at IS NOT NULL)
  )
);
-- One open retest per root attempt (a repeat start returns the pinned open
-- retest; a fresh retest follows a graded one).
CREATE UNIQUE INDEX IF NOT EXISTS retest_attempt_open
  ON app.retest_attempt(root_attempt_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS retest_attempt_root ON app.retest_attempt(root_id, created_at DESC);
CREATE INDEX IF NOT EXISTS retest_attempt_owner ON app.retest_attempt(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS retest_attempt_course ON app.retest_attempt(course_id, created_at DESC);
CREATE TABLE IF NOT EXISTS app.recovery_target (
  id uuid PRIMARY KEY,
  root_attempt_id uuid NOT NULL REFERENCES app.test_attempt(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  course_version integer NOT NULL CHECK (course_version >= 1),
  objective_index integer NOT NULL CHECK (objective_index BETWEEN 0 AND 7),
  objective text NOT NULL,
  initial_earned integer NOT NULL CHECK (initial_earned >= 0),
  initial_total integer NOT NULL CHECK (initial_total > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared')),
  cleared_by uuid REFERENCES app.retest_attempt(id),
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status = 'open' AND cleared_by IS NULL AND cleared_at IS NULL)
    OR
    (status = 'cleared' AND cleared_by IS NOT NULL AND cleared_at IS NOT NULL)
  ),
  UNIQUE (root_attempt_id, objective_index)
);
CREATE INDEX IF NOT EXISTS recovery_target_root ON app.recovery_target(root_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recovery_target_owner ON app.recovery_target(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recovery_target_attempt ON app.recovery_target(root_attempt_id, objective_index);
