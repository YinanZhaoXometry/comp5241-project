-- Additive epic-3 story 7 (disputed-item correction and honest retries)
-- schema. Story: "Disputed-item correction and honest retries (3.7)";
-- write owner: src/modules/assessment-progress (its repository is the ONLY
-- writer of app.item_dispute, app.assessment_replacement and
-- app.assessment_generation_use). Migrations 021–024's attempt/retest/
-- target/award/flag rows are untouched — graded evidence stays immutable
-- (AD-5) and earned awards stay insert-once monotonic (023 has no update or
-- delete path for them, and none is added); idempotent guards as in 015–024
-- so a cancelled run converges instead of failing.
--
-- No AI dispatch, no queue or worker change: the corrected replacement is a
-- dispute-scoped fresh assessment drawn from the same module's manually
-- checked synthetic replacement pool (the 017/019/021/024 precedent) — zero
-- egress, nothing new leaves the machine.
--
-- app.item_dispute extends story 5's one-way flag into D3's dispute state
-- machine: one row per flag (flag_id UNIQUE — the flag IS the dispute's
-- trigger; insert-once, opened in the SAME transaction as the flag), opening
-- UNDER REVIEW. The two-state lifecycle is personal study's honest channel:
-- 'under-review' until a corrected replacement independently clears the
-- disputed objective group, then the single status-guarded transition to
-- 'corrected' records WHICH replacement resolved it and when — that row IS
-- the defect annotation (the attempt/retest evidence itself is never
-- rewritten). There is deliberately no 'upheld' state: personal study has no
-- adjudicator, and an auto-uphold on a failed replacement would close the
-- Under-review state on evidence the learner may still contest while the
-- once-per-item flag could never reopen it. attempt_id always names the
-- underlying ordinary attempt (for a retest-item dispute, the retest's own
-- root attempt — the flag row's convention); retest_id is null except on
-- retest-item disputes; position identifies the disputed item inside that
-- container's snapshot; course_id pins the release whose pending/unearned
-- completion decision the dispute could affect (earned awards are never
-- revoked by any of this — C6: only pending decisions pause).
--
-- app.assessment_replacement is the corrected/replacement assessment: a
-- dispute-scoped fresh test of the disputed item's WHOLE objective group,
-- mirroring the ROOT attempt's blueprint one-for-one (same per-item points,
-- root pass mark/answer rule/rubric pinned — the retest comparability
-- rules) with questions from the NEW manually checked replacement pool, so
-- a learner who has seen the root and retest pools never meets a repeat.
-- It mirrors the retest row shape (022): grades as ONE group result
-- (objectiveIndex/earned/total/cleared — no overall triple), pins the root
-- attempt's course/version/plan revision, and the partial UNIQUE index
-- makes "one open replacement per (owner, root)" structural. A clearing
-- replacement resolves its dispute; a non-clearing one grades honestly,
-- records NO failed attempt anywhere (it is not an ordinary attempt), and
-- the dispute stays under review — retries unlimited (D3: no pedagogical
-- limit).
--
-- app.assessment_generation_use is the honest daily budget for FRESH
-- QUESTION GENERATION (retest and replacement starts — ordinary attempt
-- starts reuse the fixed root bank, are never limited and never counted).
-- The counter increments exactly once per committed NEW start inside the
-- verb's transaction; a start over the limit fails BEFORE any insert and
-- the transaction rollback leaves ZERO attempt/retest/replacement rows —
-- the rollback itself guarantees "a quota delay never records a failed
-- attempt". One row per (owner, UTC day).
--
-- ON DELETE CASCADE from test_attempt/retest_attempt/assessment_flag and
-- generated_course keeps root purge and whole-personal removal deleting
-- disputes and replacements with their evidence lineage regardless of port
-- ordering (entry 3.9 registers these derivatives in the lifecycle
-- inventory). The circular resolved_by_replacement reference is added by
-- the guarded DO-block after both tables exist (the 015/016 ADD CONSTRAINT
-- precedent).
CREATE TABLE IF NOT EXISTS app.item_dispute (
  id uuid PRIMARY KEY,
  flag_id uuid NOT NULL UNIQUE REFERENCES app.assessment_flag(id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  attempt_id uuid NOT NULL REFERENCES app.test_attempt(id) ON DELETE CASCADE,
  retest_id uuid REFERENCES app.retest_attempt(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  course_version integer NOT NULL CHECK (course_version >= 1),
  objective_index integer NOT NULL CHECK (objective_index BETWEEN 0 AND 7),
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'under-review' CHECK (status IN ('under-review','corrected')),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by_replacement uuid,
  CHECK (
    (status = 'under-review' AND resolved_at IS NULL AND resolved_by_replacement IS NULL)
    OR
    (status = 'corrected' AND resolved_at IS NOT NULL AND resolved_by_replacement IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS item_dispute_root ON app.item_dispute(root_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS item_dispute_owner ON app.item_dispute(owner_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS item_dispute_course ON app.item_dispute(course_id) WHERE status = 'under-review';
CREATE TABLE IF NOT EXISTS app.assessment_replacement (
  id uuid PRIMARY KEY,
  dispute_id uuid NOT NULL REFERENCES app.item_dispute(id) ON DELETE CASCADE,
  root_attempt_id uuid NOT NULL REFERENCES app.test_attempt(id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  course_id uuid NOT NULL REFERENCES app.generated_course(id) ON DELETE CASCADE,
  course_version integer NOT NULL CHECK (course_version >= 1),
  plan_revision_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active','graded')),
  objective_index integer NOT NULL CHECK (objective_index BETWEEN 0 AND 7),
  snapshot jsonb NOT NULL,
  answers jsonb,
  group_result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  graded_at timestamptz,
  CHECK (
    (status = 'active' AND answers IS NULL AND group_result IS NULL AND graded_at IS NULL)
    OR
    (status = 'graded' AND jsonb_typeof(answers) = 'array' AND jsonb_typeof(group_result) = 'object' AND graded_at IS NOT NULL)
  )
);
-- One open replacement per (owner, root): finish one correction at a time.
CREATE UNIQUE INDEX IF NOT EXISTS assessment_replacement_open
  ON app.assessment_replacement(owner_id, root_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS assessment_replacement_root ON app.assessment_replacement(root_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assessment_replacement_owner ON app.assessment_replacement(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assessment_replacement_dispute ON app.assessment_replacement(dispute_id, created_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'item_dispute_resolved_by_replacement_fkey'
      AND conrelid = 'app.item_dispute'::regclass
  ) THEN
    ALTER TABLE app.item_dispute
      ADD CONSTRAINT item_dispute_resolved_by_replacement_fkey
      FOREIGN KEY (resolved_by_replacement) REFERENCES app.assessment_replacement(id);
  END IF;
END
$$;
CREATE TABLE IF NOT EXISTS app.assessment_generation_use (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  day date NOT NULL,
  used integer NOT NULL CHECK (used >= 0) DEFAULT 0,
  UNIQUE (owner_id, day)
);
