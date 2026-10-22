-- Integration repair (2026-10-22, parallel-execution integrator): applied
-- migration 007-setup-export.sql rewrote the shared lifecycle_object kind
-- check without the 'diagnostic' kind that applied migration
-- 006-setup-diagnostic.sql had added, so diagnostic bundle inserts fail
-- closed on every provisioned database. Applied migrations are frozen; this
-- additive repair restores the union of both intents.
ALTER TABLE app.lifecycle_object DROP CONSTRAINT lifecycle_object_kind_check;
ALTER TABLE app.lifecycle_object ADD CHECK(kind IN ('original','extraction','selection','plan','diagnostic','export'));
