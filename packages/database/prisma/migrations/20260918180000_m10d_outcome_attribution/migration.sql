-- Migration: 20260918180000_m10d_outcome_attribution

-- CreateTable
CREATE TABLE IF NOT EXISTS "outcome_attributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "project_id" UUID NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "published_asset_id" UUID NOT NULL REFERENCES "PublishedAsset"("id") ON DELETE CASCADE,
    "retest_run_id" UUID NOT NULL REFERENCES "retest_runs"("id") ON DELETE CASCADE,
    "retest_item_id" UUID NOT NULL REFERENCES "retest_items"("id") ON DELETE CASCADE,
    "outcome_comparison_id" UUID NOT NULL REFERENCES "outcome_comparisons"("id") ON DELETE CASCADE,
    "query_id" UUID NOT NULL,
    "query_text" TEXT NOT NULL,
    "attribution_version" TEXT NOT NULL DEFAULT 'm10d-attribution-v1',
    "status" TEXT NOT NULL,
    "observed_change_type" TEXT NOT NULL DEFAULT 'NO_CHANGE',
    "signals_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "confounders_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "explanation" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outcome_attributions_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "outcome_attributions_organization_id_created_at_idx" ON "outcome_attributions"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "outcome_attributions_project_id_created_at_idx" ON "outcome_attributions"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "outcome_attributions_published_asset_id_created_at_idx" ON "outcome_attributions"("published_asset_id", "created_at");
CREATE INDEX IF NOT EXISTS "outcome_attributions_retest_run_id_idx" ON "outcome_attributions"("retest_run_id");
CREATE INDEX IF NOT EXISTS "outcome_attributions_query_id_idx" ON "outcome_attributions"("query_id");
CREATE INDEX IF NOT EXISTS "outcome_attributions_status_idx" ON "outcome_attributions"("status");

-- Unique constraint for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_attributions_outcome_comparison_id_attribution_version_key" ON "outcome_attributions"("outcome_comparison_id", "attribution_version");
