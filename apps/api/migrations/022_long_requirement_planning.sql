-- Additive planning workspaces. No original content, execution history or prior
-- migration is rewritten. Secrets are never stored in model_snapshot.
CREATE UNIQUE INDEX projects_long_plan_owner_idx ON projects(id,owner_id);
CREATE UNIQUE INDEX requirements_long_plan_project_idx ON requirement_versions(id,project_id);
CREATE TABLE long_plan_schemes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL, project_id uuid NOT NULL, requirement_version_id uuid NOT NULL,
 source_content text NOT NULL, source_hash text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), scheme jsonb NOT NULL,
 review jsonb, reviewed_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,requirement_version_id), UNIQUE(id,project_id,owner_id,requirement_version_id),
 FOREIGN KEY(project_id,owner_id) REFERENCES projects(id,owner_id),
 FOREIGN KEY(requirement_version_id,project_id) REFERENCES requirement_versions(id,project_id)
);
CREATE TABLE long_plan_scheme_history (
 id bigserial PRIMARY KEY, scheme_id uuid NOT NULL REFERENCES long_plan_schemes(id),
 snapshot jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION preserve_long_plan_scheme() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO long_plan_scheme_history(scheme_id,snapshot) VALUES(OLD.id,to_jsonb(OLD));
 RETURN NEW;
END;$$;
CREATE TRIGGER long_plan_scheme_history BEFORE UPDATE ON long_plan_schemes FOR EACH ROW EXECUTE FUNCTION preserve_long_plan_scheme();

CREATE TABLE long_plan_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,project_id uuid NOT NULL,requirement_version_id uuid NOT NULL,
 scheme_id uuid NOT NULL, scheme_revision integer NOT NULL, scheme_snapshot jsonb NOT NULL,
 source_content text NOT NULL, source_hash text NOT NULL, prompt_version text NOT NULL,
 model_snapshot jsonb NOT NULL, request_key uuid NOT NULL, dispatcher_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','paused','cancelled','needs_attention','awaiting_review','adopted','obsolete')),
 revision integer NOT NULL DEFAULT 1, lease_token uuid, lease_expires_at timestamptz,
 merge_draft jsonb, merge_review jsonb, error_code text,
 adopted_run_id uuid UNIQUE REFERENCES agent_runs(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_key),UNIQUE(scheme_id,scheme_revision),
 FOREIGN KEY(scheme_id,project_id,owner_id,requirement_version_id) REFERENCES long_plan_schemes(id,project_id,owner_id,requirement_version_id)
);
CREATE INDEX long_plan_queue_idx ON long_plan_jobs(status,created_at);
CREATE TABLE long_plan_parts (
 job_id uuid NOT NULL REFERENCES long_plan_jobs(id),segment_key text NOT NULL,position integer NOT NULL,
 start_offset integer NOT NULL,end_offset integer NOT NULL,source_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','running','succeeded','needs_attention','uncertain')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),result jsonb,
 result_origin text CHECK(result_origin IN ('model','human_correction','source_only')),error_code text,
 PRIMARY KEY(job_id,segment_key),UNIQUE(job_id,position)
);
CREATE TABLE long_plan_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL,segment_key text NOT NULL,attempt_no integer NOT NULL,
 status text NOT NULL CHECK(status IN ('dispatching','succeeded','invalid_output','uncertain','rejected')),
 prompt_version text NOT NULL,request_snapshot jsonb NOT NULL,input_hash text NOT NULL,
 raw_output text,usage jsonb,finish_reason text,duration_ms integer,error_code text,
 started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(job_id,segment_key,attempt_no),FOREIGN KEY(job_id,segment_key) REFERENCES long_plan_parts(job_id,segment_key)
);
CREATE TABLE long_plan_job_events (
 id bigserial PRIMARY KEY,job_id uuid NOT NULL REFERENCES long_plan_jobs(id),kind text NOT NULL,
 actor_id uuid REFERENCES users(id),snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE long_plan_task_conditions (
 task_id uuid NOT NULL REFERENCES tasks(id),job_id uuid NOT NULL REFERENCES long_plan_jobs(id),
 condition_key text NOT NULL,origin text NOT NULL CHECK(origin='suggested'),
 PRIMARY KEY(task_id,condition_key)
);
