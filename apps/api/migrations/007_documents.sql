CREATE TABLE project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id),
  type TEXT NOT NULL CHECK (type IN ('readme','requirements','design','api','test_report','summary')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 50000),
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_documents_project_idx ON project_documents(project_id, created_at DESC);
