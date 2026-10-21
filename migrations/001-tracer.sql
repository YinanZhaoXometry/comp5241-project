CREATE TABLE app.identity_principal (
  user_id uuid PRIMARY KEY REFERENCES auth."user"(id),
  role text NOT NULL CHECK (role IN ('learner','instructor','admin')),
  epoch integer NOT NULL DEFAULT 0
);
CREATE FUNCTION app.serialize_session_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE app.identity_principal SET epoch=epoch+1 WHERE user_id=OLD."userId";
    RETURN OLD;
  END IF;
  IF NEW."expiresAt" < OLD."expiresAt" THEN
    UPDATE app.identity_principal SET epoch=epoch+1 WHERE user_id=OLD."userId";
  ELSE
    PERFORM 1 FROM app.identity_principal WHERE user_id=OLD."userId" FOR UPDATE;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_fence BEFORE DELETE OR UPDATE ON auth.session FOR EACH ROW EXECUTE FUNCTION app.serialize_session_change();

CREATE TABLE app.lifecycle_root (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth."user"(id),
  generation integer NOT NULL DEFAULT 0, deleted_at timestamptz,
  cleanup_state text NOT NULL DEFAULT 'active' CHECK (cleanup_state IN ('active','pending','purged')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON app.lifecycle_root(owner_id);
CREATE TABLE app.lifecycle_object (
  id uuid PRIMARY KEY, root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  kind text NOT NULL CHECK (kind IN ('original','extraction','plan')),
  parent_ids uuid[] NOT NULL DEFAULT '{}', storage_key uuid UNIQUE,
  retention_class text NOT NULL DEFAULT 'synthetic-tracer-active',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.lifecycle_staging (
  key uuid PRIMARY KEY, owner_id uuid NOT NULL, lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
CREATE TABLE app.operation (
  id uuid PRIMARY KEY, root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  owner_id uuid NOT NULL, session_id uuid NOT NULL, generation integer NOT NULL, epoch integer NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','extracting','preview','retryable-failed','permanent-failed','canceled')),
  lease_until timestamptz, attempt_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(root_id)
);
CREATE TABLE app.command_receipt (
  owner_id uuid NOT NULL, command_key uuid NOT NULL, action text NOT NULL,
  request_hash text NOT NULL, root_id uuid NOT NULL REFERENCES app.lifecycle_root(id),
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_id,command_key)
);
CREATE TABLE app.material (
  id uuid PRIMARY KEY REFERENCES app.lifecycle_root(id), filename text NOT NULL,
  original_id uuid NOT NULL REFERENCES app.lifecycle_object(id), byte_length integer NOT NULL CHECK(byte_length>0 AND byte_length<=20971520),
  revision integer NOT NULL DEFAULT 0, extraction_id uuid REFERENCES app.lifecycle_object(id),
  draft_id uuid, confirmed_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.extraction_revision (
  id uuid PRIMARY KEY REFERENCES app.lifecycle_object(id), root_id uuid NOT NULL REFERENCES app.material(id),
  text_hash text NOT NULL, UNIQUE(root_id)
);
CREATE TABLE app.plan_revision (
  id uuid PRIMARY KEY REFERENCES app.lifecycle_object(id), root_id uuid NOT NULL REFERENCES app.material(id),
  extraction_id uuid NOT NULL REFERENCES app.extraction_revision(id), plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.plan_confirmation (
  plan_id uuid PRIMARY KEY REFERENCES app.plan_revision(id), root_id uuid NOT NULL REFERENCES app.material(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.material ADD FOREIGN KEY(draft_id) REFERENCES app.plan_revision(id), ADD FOREIGN KEY(confirmed_id) REFERENCES app.plan_revision(id);

CREATE FUNCTION app.immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable revision'; END $$;
CREATE TRIGGER immutable_plan BEFORE UPDATE ON app.plan_revision FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();
CREATE TRIGGER immutable_extraction BEFORE UPDATE ON app.extraction_revision FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();
CREATE TRIGGER immutable_confirmation BEFORE UPDATE ON app.plan_confirmation FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();