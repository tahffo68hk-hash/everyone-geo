-- Migration: 20260916190000_ai_content_engine_v2
CREATE TABLE IF NOT EXISTS content_generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES "ContentDraft"(id) ON DELETE CASCADE,
  source_revision_id UUID REFERENCES "ContentRevision"(id) ON DELETE SET NULL,
  platform VARCHAR(64),
  generation_mode VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  model VARCHAR(128) NOT NULL,
  prompt_version VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot JSONB,
  input_tokens INT,
  output_tokens INT,
  image_count INT DEFAULT 0,
  cost_usd NUMERIC(10, 6),
  error_message TEXT,
  created_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cgr_draft_id ON content_generation_runs(draft_id);
CREATE INDEX IF NOT EXISTS idx_cgr_project_id ON content_generation_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_cgr_platform ON content_generation_runs(platform);
CREATE INDEX IF NOT EXISTS idx_cgr_status ON content_generation_runs(status);

CREATE TABLE IF NOT EXISTS content_verified_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES "ContentDraft"(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  fact_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'UNVERIFIED',
  source_type VARCHAR(64) NOT NULL,
  source_ref VARCHAR(256),
  created_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cvf_draft_id ON content_verified_facts(draft_id);
CREATE INDEX IF NOT EXISTS idx_cvf_project_id ON content_verified_facts(project_id);
CREATE INDEX IF NOT EXISTS idx_cvf_status ON content_verified_facts(status);

CREATE TABLE IF NOT EXISTS content_claim_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_run_id UUID REFERENCES content_generation_runs(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES "ContentDraft"(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  claim_type VARCHAR(64) NOT NULL,
  support_status VARCHAR(32) NOT NULL,
  support_source_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cce_draft_id ON content_claim_extractions(draft_id);
CREATE INDEX IF NOT EXISTS idx_cce_run_id ON content_claim_extractions(generation_run_id);
