-- Additive migration. Existing test cases and results are retained.
ALTER TABLE practice_test_cases ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE TABLE practice_test_case_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES practice_test_cases(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('definition_changed','execution_recorded')),
  snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX practice_case_history_idx ON practice_test_case_history(case_id,recorded_at DESC);
CREATE FUNCTION keep_practice_case_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.category,OLD.title,OLD.preconditions,OLD.steps,OLD.expected) IS DISTINCT FROM
     (NEW.category,NEW.title,NEW.preconditions,NEW.steps,NEW.expected) THEN
    INSERT INTO practice_test_case_history(case_id,project_id,requirement_version_id,kind,snapshot)
      VALUES(OLD.id,OLD.project_id,OLD.requirement_version_id,'definition_changed',to_jsonb(OLD));
    NEW.revision := OLD.revision + 1;
    NEW.result := 'not_run'; NEW.execution_note := ''; NEW.executor_id := NULL; NEW.executed_at := NULL;
  ELSIF (OLD.result,OLD.execution_note,OLD.executor_id,OLD.executed_at) IS DISTINCT FROM
        (NEW.result,NEW.execution_note,NEW.executor_id,NEW.executed_at) THEN
    INSERT INTO practice_test_case_history(case_id,project_id,requirement_version_id,kind,snapshot)
      VALUES(OLD.id,OLD.project_id,OLD.requirement_version_id,'execution_recorded',to_jsonb(OLD));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER practice_case_history_before_update BEFORE UPDATE ON practice_test_cases
FOR EACH ROW EXECUTE FUNCTION keep_practice_case_history();
