CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose = 'requirement_analysis'),
  model_name TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requirement_version_id)
);
CREATE INDEX ai_generations_user_project_idx ON ai_generations(user_id, project_id, created_at DESC);
