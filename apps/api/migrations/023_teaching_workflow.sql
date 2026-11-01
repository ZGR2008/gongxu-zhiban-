-- Additive only. No existing account is promoted and no personal project is shared.
CREATE TABLE teaching_roles (
 user_id UUID NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('teacher','admin')),
 active BOOLEAN NOT NULL DEFAULT true, revision INTEGER NOT NULL DEFAULT 1,
 granted_by UUID REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,role)
);
CREATE TABLE teaching_accounts (
 user_id UUID PRIMARY KEY REFERENCES users(id), disabled BOOLEAN NOT NULL DEFAULT false,
 monthly_call_limit INTEGER CHECK(monthly_call_limit BETWEEN 0 AND 100000), revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE teaching_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, target_id UUID NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX teaching_audit_recent ON teaching_audit(created_at DESC);
CREATE TABLE teaching_classes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), teacher_id UUID NOT NULL REFERENCES users(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), join_code TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE teaching_members (
 class_id UUID NOT NULL REFERENCES teaching_classes(id), student_id UUID NOT NULL REFERENCES users(id),
 active BOOLEAN NOT NULL DEFAULT true, revision INTEGER NOT NULL DEFAULT 1, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(class_id,student_id)
);
CREATE TABLE teaching_assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), class_id UUID NOT NULL REFERENCES teaching_classes(id),
 title TEXT NOT NULL, brief TEXT NOT NULL, rubric TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')), revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ
);
CREATE TABLE teaching_claims (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id UUID NOT NULL REFERENCES teaching_assignments(id),
 student_id UUID NOT NULL REFERENCES users(id), project_id UUID NOT NULL UNIQUE REFERENCES projects(id),
 state TEXT NOT NULL DEFAULT 'working' CHECK(state IN ('working','submitted','returned','accepted')),
 revision INTEGER NOT NULL DEFAULT 1, UNIQUE(assignment_id,student_id)
);
CREATE TABLE teaching_submissions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES teaching_claims(id),
 number INTEGER NOT NULL, request_key UUID NOT NULL, requirement_version_id UUID NOT NULL REFERENCES requirement_versions(id),
 snapshot JSONB NOT NULL, fingerprint TEXT NOT NULL, student_note TEXT NOT NULL, allow_ai_review BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(claim_id,number), UNIQUE(claim_id,request_key)
);
CREATE TABLE teaching_feedback (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), submission_id UUID NOT NULL REFERENCES teaching_submissions(id),
 teacher_id UUID NOT NULL REFERENCES users(id), content TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('human','ai_assisted')), model_name TEXT, raw_ai_draft TEXT,
 revision INTEGER NOT NULL DEFAULT 1, published_at TIMESTAMPTZ, confirmed_by UUID REFERENCES users(id),
 request_key UUID, generation_state TEXT NOT NULL DEFAULT 'draft' CHECK(generation_state IN ('draft','generating','failed_or_uncertain')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(published_at IS NULL OR confirmed_by IS NOT NULL), UNIQUE(submission_id,request_key)
);
CREATE TABLE teaching_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), submission_id UUID NOT NULL UNIQUE REFERENCES teaching_submissions(id),
 teacher_id UUID NOT NULL REFERENCES users(id), decision TEXT NOT NULL CHECK(decision IN ('return','accept')),
 note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ai_call_budget (
 user_id UUID NOT NULL REFERENCES users(id), month DATE NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,month)
);
CREATE TABLE ai_call_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), model TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'dispatched', usage JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE INDEX ai_call_receipts_owner ON ai_call_receipts(user_id,created_at DESC);
