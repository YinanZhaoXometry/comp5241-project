-- Additive owner-level setup preferences (S4). One row per owner; the row is the
-- save target for goal/topic stage state and optional preferences. `revision` is
-- the pinned conflict-detection column: monotonic, incremented only when a
-- plan-relevant input (goal, topic, clarification) changes so a later plan
-- confirmation of the older draft can be rejected without erasing history.
CREATE TABLE app.setup_preference (
  owner_id uuid PRIMARY KEY REFERENCES auth."user"(id),
  stage text NOT NULL CHECK (stage IN ('materials','goal','plan','check')),
  goal text CHECK (goal IS NULL OR goal IN ('Exam preparation','Understand a topic','Apply a skill','Other')),
  topic text NOT NULL DEFAULT '' CHECK (char_length(topic) <= 160),
  clarification text NOT NULL DEFAULT '' CHECK (char_length(clarification) <= 240),
  background text NOT NULL DEFAULT '' CHECK (char_length(background) <= 400),
  time_preference text CHECK (time_preference IS NULL OR time_preference IN ('morning','afternoon','evening','flexible')),
  timezone text NOT NULL DEFAULT '' CHECK (char_length(timezone) <= 64),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  command_key uuid,
  request_hash text,
  result jsonb,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (goal <> 'Other' OR btrim(clarification) <> ''),
  CHECK (goal = 'Other' OR btrim(clarification) = '')
);
