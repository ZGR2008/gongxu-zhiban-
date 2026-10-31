-- Additive: existing documents remain revision 1; earlier history is not invented.
ALTER TABLE project_documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE TABLE project_document_history (
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision)
);
CREATE FUNCTION keep_project_document_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    INSERT INTO project_document_history(document_id,revision,content,saved_at)
      VALUES(OLD.id,OLD.revision,OLD.content,OLD.updated_at);
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := now();
  ELSE
    NEW.revision := OLD.revision;
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_document_history_before_update BEFORE UPDATE ON project_documents
FOR EACH ROW EXECUTE FUNCTION keep_project_document_history();
