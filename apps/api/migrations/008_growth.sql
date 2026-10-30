CREATE TABLE task_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('todo','doing','review','done','blocked')),
  new_status TEXT NOT NULL CHECK (new_status IN ('todo','doing','review','done','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (previous_status <> new_status)
);
CREATE INDEX task_status_events_project_created_idx ON task_status_events(project_id,created_at DESC);
