-- Explicit pairings only. Existing independent links are not converted into inferred chains.
CREATE TABLE task_test_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL,
 requirement_version_id UUID NOT NULL,
 item_id UUID NOT NULL,
 task_id UUID NOT NULL,
 case_id UUID NOT NULL,
 case_revision INTEGER NOT NULL CHECK(case_revision>0),
 status TEXT NOT NULL CHECK(status IN ('confirmed','rejected')),
 review_note TEXT NOT NULL,
 reviewed_by UUID NOT NULL REFERENCES users(id),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(item_id,task_id,case_id),
 FOREIGN KEY(item_id,project_id,requirement_version_id) REFERENCES requirement_items(id,project_id,requirement_version_id) ON DELETE CASCADE,
 FOREIGN KEY(task_id,project_id,requirement_version_id) REFERENCES tasks(id,project_id,requirement_version_id) ON DELETE CASCADE,
 FOREIGN KEY(case_id,project_id,requirement_version_id) REFERENCES practice_test_cases(id,project_id,requirement_version_id) ON DELETE CASCADE
);
CREATE INDEX task_test_version ON task_test_links(project_id,requirement_version_id);
CREATE TABLE task_test_link_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 link_id UUID NOT NULL REFERENCES task_test_links(id) ON DELETE CASCADE,
 snapshot JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION preserve_task_test_review() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO task_test_link_history(link_id,snapshot) VALUES(OLD.id,to_jsonb(OLD));
 NEW.updated_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER task_test_review_history BEFORE UPDATE ON task_test_links FOR EACH ROW EXECUTE FUNCTION preserve_task_test_review();
CREATE TRIGGER evidence_task_test AFTER INSERT OR UPDATE ON task_test_links FOR EACH ROW EXECUTE FUNCTION mark_requirement_evidence_change();
