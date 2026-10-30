CREATE TABLE code_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('javascript','typescript')),
  code TEXT NOT NULL,
  syntax_findings JSONB NOT NULL,
  ai_advice TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX code_reviews_project_idx ON code_reviews(project_id, created_at DESC);

CREATE TABLE practice_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('normal','boundary','exception')),
  title TEXT NOT NULL,
  preconditions TEXT NOT NULL,
  steps TEXT NOT NULL,
  expected TEXT NOT NULL,
  model_name TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'not_run' CHECK (result IN ('not_run','passed','failed','blocked')),
  execution_note TEXT NOT NULL DEFAULT '',
  executor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((result = 'not_run' AND executed_at IS NULL AND executor_id IS NULL) OR (result <> 'not_run' AND executed_at IS NOT NULL))
);
CREATE INDEX practice_test_cases_project_idx ON practice_test_cases(project_id, created_at DESC);
