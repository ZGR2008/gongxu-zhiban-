-- Do not infer human review for earlier confirmed runs.
ALTER TABLE agent_runs ADD COLUMN human_review JSONB;
ALTER TABLE agent_runs ADD CONSTRAINT human_review_object CHECK(human_review IS NULL OR jsonb_typeof(human_review)='object');
