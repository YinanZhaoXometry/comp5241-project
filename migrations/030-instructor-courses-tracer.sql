-- Additive epic-5 entry 1 (manual-course approval-enrollment tracer) schema.
-- Self-contained by the 2026-10-29 lane decision: numbered from 030, never
-- depending on objects from migrations 021-029 (the parallel epic-3 lane owns
-- those), idempotent like 012/014/015 so a cancelled run converges. Applied
-- only by scripts/migrate.ts; runtime code never migrates.
--
-- The tracer's records are COURSE-CONTROLLER records, not personal-study
-- lifecycle roots: no lifecycle_root/lifecycle_object rows are created here.
-- Registration in the epic-1 lifecycle inventory happens through the
-- instructor-courses derivative PORT (lifecycle-platform/derivatives.ts), the
-- same standing pattern as ai_draft_request. Instructor command receipts ride
-- their own table because epic-1's app.command_receipt is root-FK-anchored.

CREATE TABLE IF NOT EXISTS app.instructor_course (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS instructor_course_owner ON app.instructor_course(owner_id, created_at DESC);

-- One immutable manual mini-course VERSION per draft/approve step: inserted
-- rows are never updated (the trigger below, the 001 immutable_revision
-- precedent); a version is "approved" exactly when an instructor_approval row
-- references it. content holds the zod-validated manual lesson document
-- (one lesson with one derived required reading item — no AI, no tests).
CREATE TABLE IF NOT EXISTS app.instructor_course_version (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES app.instructor_course(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  content jsonb NOT NULL,
  content_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (course_id, version)
);
CREATE INDEX IF NOT EXISTS instructor_course_version_course ON app.instructor_course_version(course_id, created_at DESC);

-- Exact-version approval records (D4): approver, time and the approved
-- version's content digest. version_id PK arbitrates duplicates structurally
-- — at most one approval can ever exist per version.
CREATE TABLE IF NOT EXISTS app.instructor_approval (
  version_id uuid PRIMARY KEY REFERENCES app.instructor_course_version(id),
  approver_id uuid NOT NULL REFERENCES auth."user"(id),
  version_digest text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS instructor_approval_approver ON app.instructor_approval(approver_id);

-- Verified enrollment (D5): created ONLY by the course owner through the
-- preview/confirm action, matched SERVER-SIDE to an operator-provisioned
-- account (the identity_principal row is the verified-account marker in this
-- local no-email system; better-auth signUpEmail leaves emailVerified false).
-- UNIQUE (course_id, learner_id) arbitrates duplicate confirms; removal and
-- its authorization epoch are entry 5's contract, not this tracer's.
CREATE TABLE IF NOT EXISTS app.instructor_enrollment (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES app.instructor_course(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES auth."user"(id),
  invited_name text NOT NULL CHECK (char_length(invited_name) BETWEEN 1 AND 120),
  invited_email text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (course_id, learner_id)
);
CREATE INDEX IF NOT EXISTS instructor_enrollment_learner ON app.instructor_enrollment(learner_id, enrolled_at DESC);

-- Idempotency receipts for instructor commands (the command_receipt shape,
-- anchored on the course instead of a personal lifecycle root).
CREATE TABLE IF NOT EXISTS app.instructor_command_receipt (
  owner_id uuid NOT NULL,
  command_key uuid NOT NULL,
  action text NOT NULL,
  request_hash text NOT NULL,
  course_id uuid NOT NULL REFERENCES app.instructor_course(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_id, command_key)
);

-- Approved-or-not, a stored version never changes: content, digest and
-- version number are frozen at insert so an approval can never silently
-- repoint (AD-5/AD-6).
CREATE OR REPLACE FUNCTION app.immutable_instructor_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable revision'; END $$;
DROP TRIGGER IF EXISTS immutable_instructor_course_version ON app.instructor_course_version;
CREATE TRIGGER immutable_instructor_course_version BEFORE UPDATE ON app.instructor_course_version FOR EACH ROW EXECUTE FUNCTION app.immutable_instructor_version();
