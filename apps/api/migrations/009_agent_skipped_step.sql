-- An unconfigured embedding service is a skipped step, not a successful tool call.
ALTER TABLE agent_steps DROP CONSTRAINT agent_steps_status_check;
ALTER TABLE agent_steps ADD CONSTRAINT agent_steps_status_check CHECK (status IN ('running','succeeded','failed','skipped'));
