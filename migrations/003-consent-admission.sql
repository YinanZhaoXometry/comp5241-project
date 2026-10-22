-- Additive consent/policy-admission schema (story S3). No existing table changes.
-- Processor policy is a separate axis from owner consent: an ineligible or
-- unknown configuration stays blocked regardless of any submitted preference.
CREATE TABLE app.processor_configuration (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  provider text NOT NULL,
  purpose text NOT NULL,
  categories jsonb NOT NULL,
  retention_notice text NOT NULL,
  eligibility text NOT NULL CHECK (eligibility IN ('eligible','ineligible')),
  synthetic_test boolean NOT NULL DEFAULT false,
  daily_admission_limit integer NOT NULL CHECK (daily_admission_limit>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Disclosure revisions are immutable: changing processor/purpose/categories/
-- retention always means a new version row, never an update of the old one.
-- Reuses the existing app.immutable_revision() trigger function (see 002).
CREATE TRIGGER immutable_processor_configuration BEFORE UPDATE ON app.processor_configuration
  FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();

-- One row per owner decision command; the current decision is the latest row.
-- Primary key plus request hash makes a replayed command return the original
-- outcome and a reused key with a different request a conflict (one effect).
CREATE TABLE app.processing_decision (
  owner_id uuid NOT NULL REFERENCES auth."user"(id),
  command_key uuid NOT NULL,
  configuration_id uuid NOT NULL REFERENCES app.processor_configuration(id),
  disclosure_version integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('granted','declined','withdrawn')),
  request_hash text NOT NULL,
  session_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_id,command_key)
);
CREATE INDEX processing_decision_current ON app.processing_decision(owner_id,decided_at DESC);

-- Scoped dispatch admission receipts. Content-free by design: IDs, purpose and
-- outcome only — never document text, prompts, excerpts, rosters or payloads.
CREATE TABLE app.dispatch_admission (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  command_key uuid NOT NULL,
  configuration_id uuid NOT NULL REFERENCES app.processor_configuration(id),
  purpose text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('admitted','rejected-late','blocked-ineligible','blocked-consent','blocked-withdrawn','blocked-fence','blocked-quota')),
  object_ids uuid[] NOT NULL DEFAULT '{}',
  session_id uuid NOT NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX dispatch_admission_owner ON app.dispatch_admission(owner_id,created_at);
-- Quota counts admitted dispatches per owner per local day; the partial index
-- keeps the count bounded and never counts denied attempts against the quota.
CREATE INDEX dispatch_admission_daily ON app.dispatch_admission(owner_id,created_at) WHERE outcome='admitted';

-- The seeded configuration is deliberately ineligible: F3 processor retention/
-- deletion/non-training evidence does not exist, so external processing stays
-- fail-closed while manual setup, export and deletion remain available.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000001',1,
  'No external provider configured (local synthetic scope)',
  'Topic inference and study-plan drafting from acknowledged source revisions',
  '["selected source excerpts","stated goal and topic"]'::jsonb,
  'No external processor has verified non-training use, bounded retention or deletion guarantees. Standard API terms do not satisfy the platform deletion policy.',
  'ineligible',false,20
);

-- Version 2 is a SYNTHETIC TEST configuration only. Its provider is the local
-- synthetic test spy: no external endpoint, account or live AI exists. It keeps
-- the consent/admission boundary demonstrable (S3/U3) and must never be
-- presented or relied on as compliant live AI; real eligibility still requires
-- the F3 evidence story S6 is blocked on.
INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
VALUES (
  '52410003-0000-4000-8000-000000000002',2,
  'Synthetic test spy (local only — not compliant live AI)',
  'Boundary demonstration: topic inference and study-plan drafting from acknowledged source revisions',
  '["selected source excerpts","stated goal and topic"]'::jsonb,
  'Synthetic test configuration. Nothing leaves this machine: dispatch effects stay on the local synthetic test spy and are discarded. This is not a retention, deletion or non-training commitment for any external provider.',
  'eligible',true,3
);
