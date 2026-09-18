-- Migration: 20260918170000_m10c_outcome_comparison

-- CreateTable
CREATE TABLE IF NOT EXISTS "outcome_comparisons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "project_id" UUID NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "published_asset_id" UUID NOT NULL REFERENCES "PublishedAsset"("id") ON DELETE CASCADE,
    "retest_run_id" UUID NOT NULL REFERENCES "retest_runs"("id") ON DELETE CASCADE,
    "retest_item_id" UUID NOT NULL REFERENCES "retest_items"("id") ON DELETE CASCADE,
    "query_id" UUID NOT NULL,
    "query_text" TEXT NOT NULL,
    "baseline_evidence_id" UUID,
    "retest_evidence_id" UUID,
    "baseline_compatibility" TEXT NOT NULL,
    "comparison_status" TEXT NOT NULL,
    "comparison_version" TEXT NOT NULL DEFAULT 'm10c-outcome-v1',
    "before_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "after_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "delta_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "summary" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outcome_comparisons_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "outcome_comparisons_organization_id_created_at_idx" ON "outcome_comparisons"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "outcome_comparisons_project_id_created_at_idx" ON "outcome_comparisons"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "outcome_comparisons_published_asset_id_created_at_idx" ON "outcome_comparisons"("published_asset_id", "created_at");
CREATE INDEX IF NOT EXISTS "outcome_comparisons_retest_run_id_idx" ON "outcome_comparisons"("retest_run_id");
CREATE INDEX IF NOT EXISTS "outcome_comparisons_query_id_idx" ON "outcome_comparisons"("query_id");
CREATE INDEX IF NOT EXISTS "outcome_comparisons_comparison_status_idx" ON "outcome_comparisons"("comparison_status");

-- Unique constraint for idempotency: one outcome per retest item per comparison version
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_comparisons_retest_item_id_comparison_version_key" ON "outcome_comparisons"("retest_item_id", "comparison_version");
