-- Source change counters, not correctness scores. Existing documents have no inferred snapshot.
CREATE TABLE requirement_evidence_state (
  requirement_version_id UUID PRIMARY KEY REFERENCES requirement_versions(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_revision INTEGER NOT NULL DEFAULT 0 CHECK (task_revision>=0),
  case_revision INTEGER NOT NULL DEFAULT 0 CHECK (case_revision>=0),
  trace_revision INTEGER NOT NULL DEFAULT 0 CHECK (trace_revision>=0),
  document_revision INTEGER NOT NULL DEFAULT 0 CHECK (document_revision>=0)
);
INSERT INTO requirement_evidence_state(requirement_version_id,project_id) SELECT id,project_id FROM requirement_versions;
ALTER TABLE project_documents ADD COLUMN source_snapshot JSONB;

CREATE FUNCTION mark_requirement_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row RECORD; category TEXT;
BEGIN
  IF TG_OP='DELETE' THEN source_row:=OLD; ELSE source_row:=NEW; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  category:=CASE TG_TABLE_NAME WHEN 'tasks' THEN 'task' WHEN 'practice_test_cases' THEN 'case'
    WHEN 'project_documents' THEN 'document' ELSE 'trace' END;
  -- Lazy materialization of suggestions and original source items is a read-side
  -- convenience, not a new human decision. Only reviewed relations invalidate evidence.
  IF TG_TABLE_NAME='trace_links' THEN
    IF TG_OP='INSERT' AND NEW.reviewed_at IS NULL THEN RETURN NEW; END IF;
    IF TG_OP='DELETE' AND OLD.reviewed_at IS NULL THEN RETURN OLD; END IF;
    IF TG_OP='UPDATE' AND OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NULL THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='requirement_items' THEN
    IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.change_reviewed_at IS NOT DISTINCT FROM NEW.change_reviewed_at) THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO requirement_evidence_state(requirement_version_id,project_id,task_revision,case_revision,trace_revision,document_revision)
    VALUES(source_row.requirement_version_id,source_row.project_id,(category='task')::int,(category='case')::int,(category='trace')::int,(category='document')::int)
    ON CONFLICT(requirement_version_id) DO UPDATE SET
      task_revision=requirement_evidence_state.task_revision+EXCLUDED.task_revision,
      case_revision=requirement_evidence_state.case_revision+EXCLUDED.case_revision,
      trace_revision=requirement_evidence_state.trace_revision+EXCLUDED.trace_revision,
      document_revision=requirement_evidence_state.document_revision+EXCLUDED.document_revision;
  RETURN source_row;
END;
$$;
CREATE TRIGGER evidence_task AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION mark_requirement_evidence_change();
CREATE TRIGGER evidence_case AFTER INSERT OR UPDATE ON practice_test_cases FOR EACH ROW EXECUTE FUNCTION mark_requirement_evidence_change();
CREATE TRIGGER evidence_trace AFTER INSERT OR UPDATE ON trace_links FOR EACH ROW EXECUTE FUNCTION mark_requirement_evidence_change();
CREATE TRIGGER evidence_item_review AFTER UPDATE ON requirement_items FOR EACH ROW EXECUTE FUNCTION mark_requirement_evidence_change();
CREATE TRIGGER evidence_document AFTER INSERT OR UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION mark_requirement_evidence_change();
