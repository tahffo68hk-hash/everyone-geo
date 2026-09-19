-- Migration: 20260919120000_ai_generation_provenance
-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_generations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "project_id" UUID REFERENCES "Project"("id") ON DELETE CASCADE,
    "user_id" UUID REFERENCES "User"("id") ON DELETE SET NULL,
    "feature" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requested_model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "input_snapshot" JSONB DEFAULT '{}'::jsonb,
    "output_snapshot" JSONB DEFAULT '{}'::jsonb,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost" NUMERIC(10, 6),
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- Indexes for ai_generations
CREATE INDEX IF NOT EXISTS "ai_generations_organization_id_created_at_idx" ON "ai_generations"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_generations_project_id_created_at_idx" ON "ai_generations"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_generations_feature_idx" ON "ai_generations"("feature");
CREATE INDEX IF NOT EXISTS "ai_generations_entity_type_entity_id_idx" ON "ai_generations"("entity_type", "entity_id");
