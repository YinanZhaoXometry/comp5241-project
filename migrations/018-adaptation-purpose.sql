-- Additive epic-2 S4 (background and goal adaptation) schema. No new tables:
-- the adaptation record lives inside the settled course content jsonb (content
-- v3: a per-lesson treatment framing paragraph plus a course-level adaptation
-- {track, backgroundSummary}), and preferences storage stays epic-1's unchanged
-- setup_preference row. Idempotent guard as in 012/015/016 so a cancelled run
-- converges instead of failing.
--
-- Configuration v7 widens the consented purpose CUMULATIVELY: the learner's
-- STATED BACKGROUND joins the consented categories so generation can pitch the
-- same objective per track (plain language, familiar examples and explicit
-- prerequisites for non-CS beginners; application scenarios and trade-off
-- depth for CS graduates) while factual claims and source links stay identical
-- across tracks. Existing v6 grants honestly lapse; one owner re-grant gates
-- generation (and, because the purpose is shared, setup assistance and the
-- supplement pass re-grant under v7 too). The processor behind v7 remains the
-- LOCAL SYNTHETIC FIXTURE; live admission stays deferred to feasibility gates
-- F-A/F-B — no external dispatch happens under this version, and no
-- compliance, non-training, retention or live-dispatch claim is made anywhere.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000007',7,
  'Local synthetic generation fixture (no external dispatch; live admissions deferred to F-A/F-B)',
  'Setup assistance and mini-course generation: topic inference, study-plan drafting, optional starting-check items, source-linked mini-course lessons from the confirmed plan pitched to the stated background, and public-source supplement proposals for declared plan gaps',
  '["selected source excerpts","stated goal and topic","stated background","confirmed plan outcomes","confirmed plan mini-course outline","gap descriptions","generated lesson summaries"]'::jsonb,
  'Local synthetic fixture only in this version: generation and supplement proposals run on this machine and send nothing to any external provider, and source fetch runs on deterministic local fixtures with zero network egress. The stated background is used only to pitch lesson treatment (plain language versus application depth); factual claims and source links stay identical for every track, and an empty or unmatched background stays neutral. Live processor admission is deferred to gate F-A and live source fetch to gate F-B; no compliance or live-dispatch claim is made.',
  'eligible',true,20
) ON CONFLICT (version) DO NOTHING;

-- Epic-2 S4 review fix: the generation request row PINS the pitch-relevant
-- preference fields (goal, topic, background) at request time as one nullable
-- jsonb snapshot {"goal","topic","background"}. The worker consumes the PIN,
-- never a live re-read, so a background edited between request and worker-run
-- cannot re-pitch the settled course; rows without a pin (pre-review legacy
-- rows) fall back to the current preference row. Additive and idempotent; no
-- existing rows change.
ALTER TABLE app.generated_course ADD COLUMN IF NOT EXISTS preference_pin jsonb;
