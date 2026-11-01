-- Existing records remain personal. This does not publish any uploaded material.
ALTER TABLE knowledge_documents ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE knowledge_documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'personal' CHECK(visibility IN ('personal','platform_public'));
ALTER TABLE knowledge_documents ADD COLUMN content_hash TEXT;
ALTER TABLE knowledge_documents ADD COLUMN source_metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_scope_owner CHECK((visibility='personal' AND owner_id IS NOT NULL) OR (visibility='platform_public' AND owner_id IS NULL));
CREATE UNIQUE INDEX public_knowledge_content_unique ON knowledge_documents(content_hash) WHERE visibility='platform_public';
CREATE UNIQUE INDEX public_knowledge_lesson_version ON knowledge_documents((source_metadata->>'lessonId'),(source_metadata->>'version')) WHERE visibility='platform_public';
CREATE TABLE public_knowledge_imports (
 content_hash TEXT PRIMARY KEY, document_id UUID NOT NULL REFERENCES knowledge_documents(id),
 lesson_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'saved', error_code TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
