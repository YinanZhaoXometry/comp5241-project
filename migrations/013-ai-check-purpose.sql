-- Additive S7 take-path closure schema. No existing table rows change.
-- Idempotent guards as in 012 (a cancelled run must converge, not fail).
-- Configuration v4 extends the owner-admitted purpose (epic memlog 25–26, 29)
-- to cover the optional starting-check items: the consent disclosure names the
-- widened purpose and confirmed-plan outcomes category, so a learner's v3
-- grant honestly lapses and one re-grant is required. Still owner-admitted,
-- terms unverified — no D5-compliance or F3-passed claim anywhere.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000004',4,
  'Moonshot Kimi coding endpoint (owner-admitted, terms unverified)',
  'Setup assistance: topic inference, study-plan drafting and optional starting-check items',
  '["selected source excerpts","stated goal and topic","confirmed plan outcomes"]'::jsonb,
  'Live endpoint admitted by owner decision on 2026-10-24 (Moonshot Kimi coding endpoint). Provider terms have NOT been verified for non-training use, retention or deletion; no compliance claim is made. Synthetic non-personal test material only: selected source excerpts, the stated goal/topic and the confirmed plan outcomes are sent to the endpoint.',
  'eligible',true,20
) ON CONFLICT (version) DO NOTHING;

-- The advisory request row now carries which pipeline it belongs to: the S6
-- plan draft or the S7 starting-check item generation. Existing rows keep
-- 'plan'. One row per admission is unchanged; the ledger is shared, so the
-- owner budget cap covers both kinds together.
ALTER TABLE app.ai_draft_request
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'plan'
  CHECK (kind IN ('plan','check'));
CREATE INDEX IF NOT EXISTS ai_draft_request_root_kind ON app.ai_draft_request(root_id,kind,created_at DESC);
