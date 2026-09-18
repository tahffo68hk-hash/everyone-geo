-- Migration: 20260918160000_m10b_geo_retest_orchestration

-- 1. Create retest_runs table
CREATE TABLE IF NOT EXISTS "retest_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "project_id" UUID NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "published_asset_id" UUID NOT NULL REFERENCES "PublishedAsset"("id") ON DELETE CASCADE,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "query_set_id" UUID,
    "query_snapshot" JSONB NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "engine_id" UUID,
    "engine_key" TEXT NOT NULL DEFAULT 'mock-default',
    "engine_name" TEXT DEFAULT 'Mock Engine',
    "requested_model" TEXT,
    "response_model" TEXT,
    "model" TEXT NOT NULL DEFAULT 'mock-model',
    "model_version" TEXT,
    "retrieval_mode" "RetrievalMode" NOT NULL DEFAULT 'api_plain',
    "source_type" "SourceType" NOT NULL DEFAULT 'mock',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "baseline_policy" TEXT NOT NULL DEFAULT 'MOST_RECENT_BEFORE_PUBLICATION',
    "baseline_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "input_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "completed_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retest_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "retest_runs_organization_id_created_at_idx" ON "retest_runs"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "retest_runs_project_id_created_at_idx" ON "retest_runs"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "retest_runs_published_asset_id_created_at_idx" ON "retest_runs"("published_asset_id", "created_at");
CREATE INDEX IF NOT EXISTS "retest_runs_status_idx" ON "retest_runs"("status");

-- 2. Create retest_items table
CREATE TABLE IF NOT EXISTS "retest_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "retest_run_id" UUID NOT NULL REFERENCES "retest_runs"("id") ON DELETE CASCADE,
    "query_id" UUID NOT NULL,
    "query_text" TEXT NOT NULL,
    "query_type" TEXT,
    "sanity" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "run_id" UUID,
    "evidence_id" UUID,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "baseline_evidence_id" UUID,
    "baseline_status" TEXT,
    "baseline_warning" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retest_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "retest_items_retest_run_id_idx" ON "retest_items"("retest_run_id");
CREATE INDEX IF NOT EXISTS "retest_items_query_id_idx" ON "retest_items"("query_id");
CREATE INDEX IF NOT EXISTS "retest_items_status_idx" ON "retest_items"("status");
