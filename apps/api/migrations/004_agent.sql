CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'awaiting_review', 'failed', 'confirmed')),
  plan JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX agent_runs_project_idx ON agent_runs(project_id, created_at DESC);
CREATE TABLE agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  output_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX agent_steps_run_idx ON agent_steps(run_id, started_at);
CREATE TABLE agent_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES agent_steps(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('knowledge_search', 'validate_plan')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  input_summary TEXT NOT NULL,
  output_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id) ON DELETE CASCADE,
  agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  description TEXT NOT NULL,
  deliverable TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_run_id, plan_key)
);
CREATE TABLE task_dependencies (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY(task_id, depends_on_task_id),
  CHECK(task_id <> depends_on_task_id)
);
