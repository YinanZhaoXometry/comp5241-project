-- Additive S6 owner-admitted AI processing schema. No existing table changes.
-- Idempotent guards: a cancelled run on 2026-10-24 applied this file's rows
-- without recording completion, so a re-run must converge instead of failing
-- (the 011 additive-repair precedent).
-- The configuration below is admitted by OWNER DECISION recorded 2026-10-24,
-- not by verified provider terms: no D5-compliance, F3-passed, non-training,
-- retention or deletion claim is made anywhere. Only synthetic non-personal
-- test material (selected source excerpts and the stated goal/topic) may be
-- sent, and every dispatch still runs through the existing S3 admission and
-- settlement machinery.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000003',3,
  'Moonshot Kimi coding endpoint (owner-admitted, terms unverified)',
  'Topic inference and study-plan drafting from acknowledged source revisions',
  '["selected source excerpts","stated goal and topic"]'::jsonb,
  'Live endpoint admitted by owner decision on 2026-10-24 (Moonshot Kimi coding endpoint). Provider terms have NOT been verified for non-training use, retention or deletion; no compliance claim is made. Synthetic non-personal test material only: selected source excerpts and the stated goal/topic are sent to the endpoint.',
  'eligible',true,20
) ON CONFLICT (version) DO NOTHING;

-- One advisory AI draft pipeline run per admitted dispatch. The row holds the
-- bounded outcome only: topics + planSchema-shaped draft (advisory UI state the
-- learner edits and confirms through the unchanged savePlan/confirmPlan path),
-- model provenance and the provider-claimed usage. No prompt text, no source
-- excerpts and no provider key are ever stored here. Statuses are terminal
-- monotonic: pending -> ready | failed; failure_code carries the honest
-- content-free reason (adapter error codes plus 'rejected-late').
CREATE TABLE IF NOT EXISTS app.ai_draft_request (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  admission_id uuid NOT NULL REFERENCES app.dispatch_admission(id),
  status text NOT NULL CHECK (status IN ('pending','ready','failed')),
  failure_code text,
  result jsonb,
  model text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz
);
-- One request per admission: a replayed command can never create a second
-- pipeline effect, and settlement stays the single accepted-effect point.
CREATE UNIQUE INDEX IF NOT EXISTS ai_draft_request_admission ON app.ai_draft_request(admission_id);
CREATE INDEX IF NOT EXISTS ai_draft_request_root ON app.ai_draft_request(root_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_draft_request_owner ON app.ai_draft_request(owner_id,created_at DESC);

-- Content-free owner-scoped budget accounting: per-dispatch token counts as
-- CLAIMED BY THE PROVIDER (untrusted, labeled as such in code and UI); never
-- prompts, results, excerpts or credentials. Rows deliberately survive root
-- purges (request_id is set NULL by the foreign key) so the owner's ledger
-- never under-counts already-dispatched tokens after a deletion; whole-personal
-- removal purges them with the owner via the S9 derivative port.
CREATE TABLE IF NOT EXISTS app.ai_dispatch_ledger (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  request_id uuid REFERENCES app.ai_draft_request(id) ON DELETE SET NULL,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  total_tokens integer NOT NULL CHECK (total_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ai_dispatch_ledger_owner ON app.ai_dispatch_ledger(owner_id,created_at);
