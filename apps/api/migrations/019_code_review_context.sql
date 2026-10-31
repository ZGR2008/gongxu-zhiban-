-- Additive only. Historical reviews retain unknown provenance (NULL).
ALTER TABLE code_reviews ADD COLUMN requirement_version_id UUID;
ALTER TABLE code_reviews ADD COLUMN review_context JSONB;
ALTER TABLE code_reviews ADD CONSTRAINT review_requirement_project
 FOREIGN KEY(requirement_version_id,project_id) REFERENCES requirement_versions(id,project_id);
CREATE INDEX code_reviews_source_version ON code_reviews(project_id,requirement_version_id);
