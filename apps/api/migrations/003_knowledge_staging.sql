-- Parsing and storage work even before an embedding provider is configured.
ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS knowledge_documents_status_check;
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_status_check
  CHECK (status IN ('pending', 'processing', 'awaiting_embedding', 'ready', 'failed'));
ALTER TABLE knowledge_chunks ALTER COLUMN embedding DROP NOT NULL;
ALTER TABLE knowledge_chunks ALTER COLUMN embedding_model DROP NOT NULL;
