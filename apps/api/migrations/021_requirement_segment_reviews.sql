-- Additive, version-scoped preparation. Does not alter original requirements,
-- tests, execution records or generation limits. Review is not AI validation.
CREATE TABLE requirement_segment_reviews (
 project_id uuid NOT NULL REFERENCES projects(id),
 requirement_version_id uuid NOT NULL REFERENCES requirement_versions(id),
 segment_key text NOT NULL,
 source_hash text NOT NULL,
 decision text NOT NULL CHECK (decision IN ('accepted','needs_changes')),
 note text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 reviewed_by uuid NOT NULL REFERENCES users(id),
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id,requirement_version_id,segment_key)
);
CREATE TABLE requirement_segment_review_history (
 id bigserial PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 requirement_version_id uuid NOT NULL REFERENCES requirement_versions(id),
 segment_key text NOT NULL,
 snapshot jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION preserve_segment_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO requirement_segment_review_history(project_id,requirement_version_id,segment_key,snapshot)
 VALUES(OLD.project_id,OLD.requirement_version_id,OLD.segment_key,to_jsonb(OLD));
 RETURN NEW;
END;
$$;
CREATE TRIGGER segment_review_history BEFORE UPDATE ON requirement_segment_reviews
FOR EACH ROW EXECUTE FUNCTION preserve_segment_review();
