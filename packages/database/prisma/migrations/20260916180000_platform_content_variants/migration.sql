-- CreateTable: platform_content_variants
CREATE TABLE IF NOT EXISTS platform_content_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES "ContentDraft"(id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES "ContentRevision"(id) ON DELETE CASCADE,
  platform VARCHAR(64) NOT NULL,
  content_type VARCHAR(64) NOT NULL,
  generation_mode VARCHAR(64) NOT NULL,
  title VARCHAR(512) NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  cover_text VARCHAR(512),
  image_briefs JSONB DEFAULT '[]'::jsonb,
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(32) DEFAULT 'GENERATED',
  created_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcv_draft_id ON platform_content_variants(draft_id);
CREATE INDEX IF NOT EXISTS idx_pcv_source_rev ON platform_content_variants(source_revision_id);
CREATE INDEX IF NOT EXISTS idx_pcv_platform ON platform_content_variants(platform);

-- CreateTable: content_image_briefs
CREATE TABLE IF NOT EXISTS content_image_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES "ContentDraft"(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES platform_content_variants(id) ON DELETE SET NULL,
  platform VARCHAR(64) NOT NULL,
  asset_type VARCHAR(64) NOT NULL,
  title VARCHAR(256) NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  style VARCHAR(64) NOT NULL,
  ratio VARCHAR(32) NOT NULL,
  text_overlay JSONB,
  notes TEXT,
  safe_fact_check TEXT,
  created_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cib_draft_id ON content_image_briefs(draft_id);
CREATE INDEX IF NOT EXISTS idx_cib_variant_id ON content_image_briefs(variant_id);
CREATE INDEX IF NOT EXISTS idx_cib_platform ON content_image_briefs(platform);
