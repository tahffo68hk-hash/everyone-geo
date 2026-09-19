-- Migration: 20260919100000_m11a_learning_signal_foundation

-- CreateTable
CREATE TABLE IF NOT EXISTS "learning_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "project_id" UUID NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "published_asset_id" UUID NOT NULL REFERENCES "PublishedAsset"("id") ON DELETE CASCADE,
    "retest_run_id" UUID NOT NULL REFERENCES "retest_runs"("id") ON DELETE CASCADE,
    "retest_item_id" UUID NOT NULL REFERENCES "retest_items"("id") ON DELETE CASCADE,
    "outcome_comparison_id" UUID NOT NULL REFERENCES "outcome_comparisons"("id") ON DELETE CASCADE,
    "outcome_attribution_id" UUID NOT NULL REFERENCES "outcome_attributions"("id") ON DELETE CASCADE,
    "query_id" UUID NOT NULL,
    "query_text" TEXT NOT NULL,
    "observation_version" TEXT NOT NULL DEFAULT 'm11a-learning-observation-v1',
    "observation_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "attribution_status" TEXT NOT NULL,
    "baseline_compatibility" TEXT NOT NULL,
    "signals_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "evidence_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "context_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "summary" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_observations_pkey" PRIMARY KEY ("id")
);

-- Indexes for learning_observations
CREATE INDEX IF NOT EXISTS "learning_observations_organization_id_created_at_idx" ON "learning_observations"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "learning_observations_project_id_created_at_idx" ON "learning_observations"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "learning_observations_published_asset_id_created_at_idx" ON "learning_observations"("published_asset_id", "created_at");
CREATE INDEX IF NOT EXISTS "learning_observations_outcome_attribution_id_idx" ON "learning_observations"("outcome_attribution_id");
CREATE INDEX IF NOT EXISTS "learning_observations_outcome_comparison_id_idx" ON "learning_observations"("outcome_comparison_id");
CREATE INDEX IF NOT EXISTS "learning_observations_query_id_idx" ON "learning_observations"("query_id");
CREATE INDEX IF NOT EXISTS "learning_observations_observation_type_idx" ON "learning_observations"("observation_type");
CREATE INDEX IF NOT EXISTS "learning_observations_direction_idx" ON "learning_observations"("direction");
CREATE INDEX IF NOT EXISTS "learning_observations_attribution_status_idx" ON "learning_observations"("attribution_status");

-- Unique constraint for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS "learning_observations_outcome_attribution_id_observation_type_observation_version_key" ON "learning_observations"("outcome_attribution_id", "observation_type", "observation_version");

-- CreateTable
CREATE TABLE IF NOT EXISTS "learning_aggregates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "project_id" UUID NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "aggregate_key" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "likely_related_count" INTEGER NOT NULL DEFAULT 0,
    "insufficient_count" INTEGER NOT NULL DEFAULT 0,
    "confounded_count" INTEGER NOT NULL DEFAULT 0,
    "no_change_count" INTEGER NOT NULL DEFAULT 0,
    "positive_count" INTEGER NOT NULL DEFAULT 0,
    "negative_count" INTEGER NOT NULL DEFAULT 0,
    "neutral_count" INTEGER NOT NULL DEFAULT 0,
    "supporting_observation_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "attribution_distribution" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "context_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "summary" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_aggregates_pkey" PRIMARY KEY ("id")
);

-- Indexes for learning_aggregates
CREATE INDEX IF NOT EXISTS "learning_aggregates_organization_id_idx" ON "learning_aggregates"("organization_id");
CREATE INDEX IF NOT EXISTS "learning_aggregates_project_id_idx" ON "learning_aggregates"("project_id");

-- Unique constraint for learning_aggregates
CREATE UNIQUE INDEX IF NOT EXISTS "learning_aggregates_project_id_aggregate_key_key" ON "learning_aggregates"("project_id", "aggregate_key");
