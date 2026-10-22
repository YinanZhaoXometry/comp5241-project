-- Additive evolution. Existing originals/revisions/v1 queue envelopes are retained.
ALTER TABLE app.lifecycle_object DROP CONSTRAINT lifecycle_object_kind_check;
ALTER TABLE app.lifecycle_object ADD CHECK(kind IN ('original','extraction','selection','plan'));
ALTER TABLE app.lifecycle_object ADD COLUMN invalidated_at timestamptz;
CREATE INDEX lifecycle_parents ON app.lifecycle_object USING gin(parent_ids);
ALTER TABLE app.material ADD COLUMN format text NOT NULL DEFAULT 'txt' CHECK(format IN ('txt','md','pdf','docx'));
ALTER TABLE app.extraction_revision ADD COLUMN metadata jsonb;
ALTER TABLE app.operation ADD COLUMN failure_reason text CHECK(failure_reason IN ('unsupported','protected','corrupt','unsafe','no-text','resource','service'));

CREATE TABLE app.study_batch (
  id uuid PRIMARY KEY REFERENCES app.lifecycle_root(id), revision integer NOT NULL DEFAULT 0,
  manifest_revision integer NOT NULL DEFAULT 0, selection_id uuid, draft_id uuid, confirmed_id uuid,
  legacy boolean NOT NULL DEFAULT false
);
CREATE TABLE app.batch_slot (
  id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES app.study_batch(id),
  position integer NOT NULL CHECK(position>=0), root_id uuid NOT NULL UNIQUE REFERENCES app.lifecycle_root(id),
  filename text NOT NULL, mime text NOT NULL, format text NOT NULL CHECK(format IN ('txt','md','pdf','docx')),
  byte_length integer NOT NULL CHECK(byte_length>0 AND byte_length<=20971520), removed boolean NOT NULL DEFAULT false,
  UNIQUE(batch_id,position)
);
CREATE TABLE app.selection_revision (
  id uuid PRIMARY KEY REFERENCES app.lifecycle_object(id), batch_id uuid NOT NULL REFERENCES app.study_batch(id),
  manifest_revision integer NOT NULL, excluded jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.selection_source (
  selection_id uuid NOT NULL REFERENCES app.selection_revision(id), slot_id uuid NOT NULL REFERENCES app.batch_slot(id),
  root_id uuid NOT NULL REFERENCES app.lifecycle_root(id), extraction_id uuid NOT NULL REFERENCES app.extraction_revision(id),
  PRIMARY KEY(selection_id,slot_id), UNIQUE(selection_id,extraction_id)
);
ALTER TABLE app.plan_revision DROP CONSTRAINT plan_revision_root_id_fkey;
ALTER TABLE app.plan_revision ADD FOREIGN KEY(root_id) REFERENCES app.lifecycle_root(id);
ALTER TABLE app.plan_revision ADD COLUMN selection_id uuid REFERENCES app.selection_revision(id);
ALTER TABLE app.plan_confirmation DROP CONSTRAINT plan_confirmation_root_id_fkey;
ALTER TABLE app.plan_confirmation ADD FOREIGN KEY(root_id) REFERENCES app.lifecycle_root(id);
ALTER TABLE app.study_batch ADD FOREIGN KEY(selection_id) REFERENCES app.selection_revision(id), ADD FOREIGN KEY(draft_id) REFERENCES app.plan_revision(id), ADD FOREIGN KEY(confirmed_id) REFERENCES app.plan_revision(id);

-- Backfill metadata/acknowledgment from already saved singleton plans, never copy text.
ALTER TABLE app.extraction_revision DISABLE TRIGGER immutable_extraction;
UPDATE app.extraction_revision SET metadata=jsonb_build_object('format','txt','parser','bounded-documents-v2','warnings','[]'::jsonb,'locations',jsonb_build_array(jsonb_build_object('unit','lines','source','Legacy UTF-8 source','first',1,'last',1,'start',0,'end',0)));
ALTER TABLE app.extraction_revision ENABLE TRIGGER immutable_extraction;
INSERT INTO app.study_batch(id,revision,draft_id,confirmed_id,legacy) SELECT id,revision,draft_id,confirmed_id,true FROM app.material;
INSERT INTO app.batch_slot(id,batch_id,position,root_id,filename,mime,format,byte_length) SELECT id,id,0,id,filename,'text/plain','txt',byte_length FROM app.material;
-- Each legacy plan keeps its exact extraction and gets its own immutable source set.
INSERT INTO app.lifecycle_object(id,root_id,kind,parent_ids)
 SELECT gen_random_uuid(),root_id,'selection',ARRAY[extraction_id] FROM app.plan_revision;
INSERT INTO app.selection_revision(id,batch_id,manifest_revision,excluded)
 SELECT id,root_id,0,'[]'::jsonb FROM app.lifecycle_object WHERE kind='selection';
INSERT INTO app.selection_source(selection_id,slot_id,root_id,extraction_id)
 SELECT id,root_id,root_id,parent_ids[1] FROM app.lifecycle_object WHERE kind='selection';
ALTER TABLE app.plan_revision DISABLE TRIGGER immutable_plan;
UPDATE app.plan_revision p SET selection_id=(SELECT s.id FROM app.selection_revision s JOIN app.selection_source x ON x.selection_id=s.id WHERE s.batch_id=p.root_id AND x.extraction_id=p.extraction_id LIMIT 1);
ALTER TABLE app.plan_revision ENABLE TRIGGER immutable_plan;
UPDATE app.study_batch b SET selection_id=p.selection_id FROM app.plan_revision p WHERE p.id=b.draft_id;
UPDATE app.lifecycle_object o SET parent_ids=ARRAY[p.selection_id] FROM app.plan_revision p WHERE o.id=p.id;
CREATE TRIGGER immutable_selection BEFORE UPDATE ON app.selection_revision FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();
CREATE TRIGGER immutable_selection_source BEFORE UPDATE ON app.selection_source FOR EACH ROW EXECUTE FUNCTION app.immutable_revision();