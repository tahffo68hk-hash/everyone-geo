-- Migration: 20260917200000_m9b_campaign_and_calendar
CREATE TABLE IF NOT EXISTS content_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  strategy_id UUID NOT NULL REFERENCES content_strategies(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  primary_geo_gap TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_org_id ON content_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_cc_project_id ON content_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_cc_strategy_id ON content_campaigns(strategy_id);
CREATE INDEX IF NOT EXISTS idx_cc_status ON content_campaigns(status);

CREATE TABLE IF NOT EXISTS content_schedule_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
  plan_item_id UUID NOT NULL REFERENCES content_plan_items(id) ON DELETE CASCADE,
  scheduled_date TIMESTAMPTZ NOT NULL,
  scheduled_time VARCHAR(32),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  production_status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  block_reason VARCHAR(64),
  assigned_to_id UUID,
  depends_on_item_id UUID REFERENCES content_schedule_items(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csi_org_id ON content_schedule_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_csi_project_id ON content_schedule_items(project_id);
CREATE INDEX IF NOT EXISTS idx_csi_campaign_id ON content_schedule_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_csi_plan_item_id ON content_schedule_items(plan_item_id);
CREATE INDEX IF NOT EXISTS idx_csi_scheduled_date ON content_schedule_items(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_csi_production_status ON content_schedule_items(production_status);
