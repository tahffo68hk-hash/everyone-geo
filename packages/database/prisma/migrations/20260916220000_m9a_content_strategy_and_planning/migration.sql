-- Migration: 20260916220000_m9a_content_strategy_and_planning
CREATE TABLE IF NOT EXISTS content_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  title VARCHAR(256) NOT NULL,
  source_opportunity_id UUID REFERENCES "ContentOpportunity"(id) ON DELETE SET NULL,
  source_recommendation_id UUID REFERENCES "Recommendation"(id) ON DELETE SET NULL,
  source_diagnosis_id UUID REFERENCES "DiagnosisRun"(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  geo_gap TEXT NOT NULL,
  priority_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_audience TEXT NOT NULL,
  perception_goal TEXT NOT NULL,
  key_themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  platform_priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_required JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_org_id ON content_strategies(organization_id);
CREATE INDEX IF NOT EXISTS idx_cs_project_id ON content_strategies(project_id);
CREATE INDEX IF NOT EXISTS idx_cs_status ON content_strategies(status);

CREATE TABLE IF NOT EXISTS content_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES content_strategies(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  title VARCHAR(256) NOT NULL,
  platform VARCHAR(64) NOT NULL,
  format VARCHAR(64) NOT NULL,
  objective TEXT NOT NULL,
  geo_target TEXT NOT NULL,
  target_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  draft_id UUID REFERENCES "ContentDraft"(id) ON DELETE SET NULL,
  source_opportunity_id UUID REFERENCES "ContentOpportunity"(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpi_strategy_id ON content_plan_items(strategy_id);
CREATE INDEX IF NOT EXISTS idx_cpi_project_id ON content_plan_items(project_id);
CREATE INDEX IF NOT EXISTS idx_cpi_status ON content_plan_items(status);
CREATE INDEX IF NOT EXISTS idx_cpi_draft_id ON content_plan_items(draft_id);

ALTER TABLE "ContentDraft" ADD COLUMN IF NOT EXISTS "sourceStrategyId" UUID;
ALTER TABLE "ContentDraft" ADD COLUMN IF NOT EXISTS "sourcePlanItemId" UUID;
