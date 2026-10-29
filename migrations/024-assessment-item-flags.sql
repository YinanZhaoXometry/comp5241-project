-- Additive epic-3 story 5 (evidence-linked gap guidance with Unknown
-- separation) schema — the story's ONLY stored shape change: guidance itself
-- is a read-time deterministic view with no tables. Story: "Evidence-linked
-- gap guidance with Unknown separation (3.5)"; write owner:
-- src/modules/assessment-progress (its repository is the ONLY writer of
-- app.assessment_flag). Migrations 021–023's attempt/retest/target/award
-- rows are untouched; idempotent guards as in 015–023 so a cancelled run
-- converges instead of failing.
--
-- No AI dispatch, no queue or worker change: guidance derives from already
-- recorded typed evidence (scored attempts/retests, the recovery ledger,
-- epic-2 practice rows consumed read-only) — zero egress, nothing new leaves
-- the machine. The live-narrated guidance enhancement stays F-A blocked.
--
-- app.assessment_flag is the one-way unclear-item flag, assessment-shaped
-- from the diagnostic's flagItem/markUnclear precedent. Attempt and retest
-- rows are IMMUTABLE (AD-5 — answers, scores and group results never change
-- after grading), so the flag cannot live in-row the way diagnostic items
-- carry theirs: it is its own insert-once row. One row per (owner, graded
-- container item): attempt_id always names the graded ordinary attempt (for
-- a retest-item flag, the retest's own root attempt), retest_id is null
-- except on retest-item flags, position identifies the item inside that
-- container's snapshot. There is deliberately no "unset" path, no state
-- column and no outcome linkage: the flag records WITH the evidence and
-- changes no score, ledger, award or view — Under-review mechanics, pending
-- decision pauses and corrections are entry 7's, not this table's. Two
-- partial UNIQUE indexes (a plain UNIQUE would treat NULL retest_id rows as
-- distinct) make exactly-once structural; ON CONFLICT DO NOTHING covers both
-- plus the primary key. ON DELETE CASCADE from test_attempt/retest_attempt
-- and generated_course keeps root purge and whole-personal removal deleting
-- flags with their evidence lineage regardless of port ordering (entry 3.9
-- registers this derivative in the lifecycle inventory).
CREATE TABLE IF NOT EXISTS app.assessment_flag (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  attempt_id uuid NOT NULL REFERENCES app.test_attempt(id) ON DELETE CASCADE,
  retest_id uuid REFERENCES app.retest_attempt(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  flagged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_flag_attempt_item ON app.assessment_flag(owner_id, attempt_id, position) WHERE retest_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assessment_flag_retest_item ON app.assessment_flag(owner_id, retest_id, position) WHERE retest_id IS NOT NULL;
