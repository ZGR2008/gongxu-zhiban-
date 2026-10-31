-- Optional on legacy clients. A browser request identity does not contain credentials.
ALTER TABLE agent_runs ADD COLUMN request_key UUID;
CREATE UNIQUE INDEX agent_request_identity ON agent_runs(project_id,request_key) WHERE request_key IS NOT NULL;
