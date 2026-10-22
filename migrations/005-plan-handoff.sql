-- P3 / S5 additive evolution. The handoff query itself is zero-DDL: it reads only
-- existing immutable tables (plan_revision / plan_confirmation / selection_revision /
-- selection_source / batch_slot / extraction_revision). This single nullable column
-- records, per saved plan draft, the setup-preference revision it was saved against
-- (pinned cross-package name app.setup_preference from 004-setup-preferences.sql),
-- so that a goal/topic change after a draft save makes confirmation of the older
-- draft CONFLICT without erasing history (execution-plan §3 P2 pin).
-- Nullable: revisions saved before this migration and drafts saved while the owner
-- has no preference row keep NULL, and the stale-draft check is skipped for them.
ALTER TABLE app.plan_revision ADD COLUMN preference_revision integer;
