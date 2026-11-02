-- Additive migration. Existing assignments become version 1; projects and snapshots are not rewritten.
ALTER TABLE teaching_assignments ADD COLUMN create_request_key UUID;
CREATE UNIQUE INDEX teaching_assignment_request_key ON teaching_assignments(class_id,create_request_key) WHERE create_request_key IS NOT NULL;
CREATE TABLE teaching_assignment_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id UUID NOT NULL REFERENCES teaching_assignments(id),
 number INTEGER NOT NULL CHECK(number>0), state TEXT NOT NULL CHECK(state IN ('draft','published')),
 title TEXT NOT NULL, brief TEXT NOT NULL, rubric TEXT NOT NULL,
 change_note TEXT NOT NULL DEFAULT '', applicability TEXT NOT NULL DEFAULT 'new_claims_only' CHECK(applicability IN ('new_claims_only','offer_existing')),
 parent_id UUID REFERENCES teaching_assignment_versions(id), created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ,
 UNIQUE(assignment_id,number), UNIQUE(id,assignment_id)
);
CREATE UNIQUE INDEX teaching_one_assignment_draft ON teaching_assignment_versions(assignment_id) WHERE state='draft';
INSERT INTO teaching_assignment_versions(assignment_id,number,state,title,brief,rubric,created_by,published_at)
 SELECT a.id,1,a.state,a.title,a.brief,a.rubric,k.teacher_id,a.published_at FROM teaching_assignments a JOIN teaching_classes k ON k.id=a.class_id;
ALTER TABLE teaching_assignments ADD COLUMN published_version_id UUID REFERENCES teaching_assignment_versions(id);
UPDATE teaching_assignments a SET published_version_id=v.id FROM teaching_assignment_versions v WHERE v.assignment_id=a.id AND v.state='published';
ALTER TABLE teaching_claims ADD COLUMN assignment_version_id UUID;
ALTER TABLE teaching_claims ADD COLUMN acknowledged_version_id UUID REFERENCES teaching_assignment_versions(id);
UPDATE teaching_claims c SET assignment_version_id=v.id FROM teaching_assignment_versions v WHERE v.assignment_id=c.assignment_id AND v.number=1;
ALTER TABLE teaching_claims ALTER COLUMN assignment_version_id SET NOT NULL;
ALTER TABLE teaching_claims ADD FOREIGN KEY(assignment_version_id,assignment_id) REFERENCES teaching_assignment_versions(id,assignment_id);
CREATE TABLE teaching_assignment_change_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES teaching_claims(id), student_id UUID NOT NULL REFERENCES users(id),
 from_version_id UUID NOT NULL REFERENCES teaching_assignment_versions(id), to_version_id UUID NOT NULL REFERENCES teaching_assignment_versions(id),
 decision TEXT NOT NULL CHECK(decision IN ('adopt','keep')), reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE teaching_decisions ADD COLUMN review_checks JSONB;
ALTER TABLE teaching_decisions ADD COLUMN exception_reason TEXT;
CREATE FUNCTION protect_published_assignment_version() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF OLD.state='published' THEN RAISE EXCEPTION 'Published assignment versions are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END;
$$;
CREATE TRIGGER teaching_assignment_version_immutable BEFORE UPDATE OR DELETE ON teaching_assignment_versions
 FOR EACH ROW EXECUTE FUNCTION protect_published_assignment_version();
