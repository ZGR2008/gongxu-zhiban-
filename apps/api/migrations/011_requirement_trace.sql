-- Additive migration: existing requirements, tasks, test results and documents remain intact.
ALTER TABLE requirement_versions ADD CONSTRAINT requirement_project_identity UNIQUE(id,project_id);
ALTER TABLE tasks ADD CONSTRAINT task_requirement_identity UNIQUE(id,project_id,requirement_version_id);
ALTER TABLE practice_test_cases ADD CONSTRAINT case_requirement_identity UNIQUE(id,project_id,requirement_version_id);
ALTER TABLE tasks ADD COLUMN suggested_requirement_keys TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE practice_test_cases ADD COLUMN suggested_requirement_keys TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE requirement_items (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  requirement_version_id UUID NOT NULL,
  stable_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content TEXT NOT NULL,
  acceptance_candidate BOOLEAN NOT NULL,
  predecessor_id UUID REFERENCES requirement_items(id),
  change_review_note TEXT,
  change_reviewed_by UUID REFERENCES users(id),
  change_reviewed_at TIMESTAMPTZ,
  UNIQUE(requirement_version_id,stable_key),
  UNIQUE(id,project_id,requirement_version_id),
  FOREIGN KEY(requirement_version_id,project_id) REFERENCES requirement_versions(id,project_id) ON DELETE CASCADE,
  CHECK(start_offset>=0 AND end_offset>start_offset)
);
CREATE TABLE trace_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  requirement_version_id UUID NOT NULL,
  item_id UUID NOT NULL,
  task_id UUID,
  case_id UUID,
  case_revision INTEGER,
  origin TEXT NOT NULL CHECK(origin IN ('model','human')),
  status TEXT NOT NULL CHECK(status IN ('suggested','confirmed','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(item_id,project_id,requirement_version_id) REFERENCES requirement_items(id,project_id,requirement_version_id) ON DELETE CASCADE,
  FOREIGN KEY(task_id,project_id,requirement_version_id) REFERENCES tasks(id,project_id,requirement_version_id) ON DELETE CASCADE,
  FOREIGN KEY(case_id,project_id,requirement_version_id) REFERENCES practice_test_cases(id,project_id,requirement_version_id) ON DELETE CASCADE,
  CHECK((task_id IS NOT NULL AND case_id IS NULL AND case_revision IS NULL) OR (case_id IS NOT NULL AND task_id IS NULL AND case_revision IS NOT NULL))
);
CREATE UNIQUE INDEX trace_item_task ON trace_links(item_id,task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX trace_item_case ON trace_links(item_id,case_id) WHERE case_id IS NOT NULL;
CREATE INDEX trace_project_version ON trace_links(project_id,requirement_version_id);
CREATE TABLE trace_link_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES trace_links(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION preserve_trace_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO trace_link_history(link_id,snapshot) VALUES(OLD.id,to_jsonb(OLD));
  NEW.updated_at=now();
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_trace_review BEFORE UPDATE ON trace_links FOR EACH ROW EXECUTE FUNCTION preserve_trace_review();

CREATE TABLE requirement_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES requirement_items(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION preserve_requirement_change_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.change_reviewed_at IS NOT NULL THEN
    INSERT INTO requirement_change_history(item_id,snapshot) VALUES(OLD.id,to_jsonb(OLD));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_requirement_change_review BEFORE UPDATE ON requirement_items FOR EACH ROW EXECUTE FUNCTION preserve_requirement_change_review();
