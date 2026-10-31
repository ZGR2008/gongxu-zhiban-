-- Explicit project drafts are separate from paid AI review and execution records.
-- No existing review is copied or modified; the first save creates revision 1.
CREATE TABLE code_review_drafts (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('javascript','typescript')),
  code TEXT NOT NULL CHECK (length(code) <= 50000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
