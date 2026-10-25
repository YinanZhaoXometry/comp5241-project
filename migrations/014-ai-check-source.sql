-- Additive repair (the 011 precedent): migration 006's diagnostic_bundle
-- source CHECK predates the S7 owner-admitted generator. Widen it to admit the
-- 'ai-generated' origin label so generated bundles record their true source;
-- the take/submit/finish machinery is unchanged. Idempotent: converges when
-- the widened constraint is already present.
ALTER TABLE app.diagnostic_bundle DROP CONSTRAINT IF EXISTS diagnostic_bundle_source_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'diagnostic_bundle_source_check'
      AND conrelid = 'app.diagnostic_bundle'::regclass
  ) THEN
    ALTER TABLE app.diagnostic_bundle
      ADD CONSTRAINT diagnostic_bundle_source_check
      CHECK (source IN ('manual-synthetic', 'ai-generated'));
  END IF;
END
$$;
