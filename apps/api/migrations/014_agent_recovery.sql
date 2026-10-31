-- Keep every existing run and result. Creation time is the only known fallback
-- heartbeat for historical records; do not fabricate recent activity.
ALTER TABLE agent_runs ADD COLUMN heartbeat_at TIMESTAMPTZ;
ALTER TABLE agent_runs ADD COLUMN deadline_at TIMESTAMPTZ;
UPDATE agent_runs SET heartbeat_at=created_at,deadline_at=created_at+INTERVAL '10 minutes';
ALTER TABLE agent_runs ALTER COLUMN heartbeat_at SET DEFAULT now();
ALTER TABLE agent_runs ALTER COLUMN deadline_at SET DEFAULT (now()+INTERVAL '10 minutes');
CREATE INDEX agent_running_heartbeat ON agent_runs(project_id,heartbeat_at) WHERE status='running';
