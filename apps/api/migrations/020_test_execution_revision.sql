-- Add a separate optimistic token; keep definition revision and all old outcomes.
-- Existing rows begin at token 0. This is a concurrency token, not a run count.
ALTER TABLE practice_test_cases
  ADD COLUMN execution_revision INTEGER NOT NULL DEFAULT 0 CHECK (execution_revision >= 0);

CREATE OR REPLACE FUNCTION keep_practice_case_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.category,OLD.title,OLD.preconditions,OLD.steps,OLD.expected) IS DISTINCT FROM
     (NEW.category,NEW.title,NEW.preconditions,NEW.steps,NEW.expected) THEN
    INSERT INTO practice_test_case_history(case_id,project_id,requirement_version_id,kind,snapshot)
      VALUES(OLD.id,OLD.project_id,OLD.requirement_version_id,'definition_changed',to_jsonb(OLD));
    NEW.revision := OLD.revision + 1;
    NEW.execution_revision := OLD.execution_revision + 1;
    NEW.result := 'not_run'; NEW.execution_note := ''; NEW.executor_id := NULL; NEW.executed_at := NULL;
  ELSIF (OLD.result,OLD.execution_note,OLD.executor_id,OLD.executed_at,OLD.execution_revision) IS DISTINCT FROM
        (NEW.result,NEW.execution_note,NEW.executor_id,NEW.executed_at,NEW.execution_revision) THEN
    INSERT INTO practice_test_case_history(case_id,project_id,requirement_version_id,kind,snapshot)
      VALUES(OLD.id,OLD.project_id,OLD.requirement_version_id,'execution_recorded',to_jsonb(OLD));
  END IF;
  RETURN NEW;
END;
$$;
