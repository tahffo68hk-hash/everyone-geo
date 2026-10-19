CREATE TYPE "AiProvider" AS ENUM ('MOCK', 'DEEPSEEK', 'QWEN');
CREATE TYPE "QuickStartStage" AS ENUM ('BRAND', 'QUESTIONS', 'MONITOR', 'REPORT', 'CONTENT', 'DISTRIBUTION');
CREATE TYPE "QuickStartQuestionKind" AS ENUM ('DISCOVERY', 'BRANDED');
CREATE TYPE "MonitoringRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "ContentAssetStatus" AS ENUM ('DRAFT', 'SAVED');
CREATE TYPE "DistributionTaskStatus" AS ENUM ('DRAFT', 'NEEDS_HUMAN_REVIEW');

CREATE TABLE "QuickStartSession" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "querySetId" UUID,
    "currentStep" "QuickStartStage" NOT NULL DEFAULT 'BRAND',
    "provider" "AiProvider" NOT NULL DEFAULT 'MOCK',
    "model" TEXT NOT NULL DEFAULT 'geolens-mock-v1',
    "questions" JSONB,
    "questionGeneration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickStartSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoringRun" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "activeSessionId" UUID,
    "projectId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "status" "MonitoringRunStatus" NOT NULL DEFAULT 'RUNNING',
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "requestCount" INTEGER NOT NULL,
    "responseCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoringResponse" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "queryId" UUID,
    "queryText" TEXT NOT NULL,
    "kind" "QuickStartQuestionKind" NOT NULL,
    "intent" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "rawPrompt" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "brandMentioned" BOOLEAN NOT NULL,
    "mentionPosition" INTEGER,
    "competitorMentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "citations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tokens" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "costEstimate" DOUBLE PRECISION,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoReport" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "metrics" JSONB NOT NULL,
    "containsMockData" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OptimizationSuggestion" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "queryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "generation" JSONB,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "evidenceMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptimizationSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuggestionEvidence" (
    "suggestionId" UUID NOT NULL,
    "responseId" UUID NOT NULL,

    CONSTRAINT "SuggestionEvidence_pkey" PRIMARY KEY ("suggestionId", "responseId")
);

CREATE TABLE "ContentAsset" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "reportId" UUID,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "status" "ContentAssetStatus" NOT NULL DEFAULT 'DRAFT',
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "evidenceMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentGeneration" (
    "id" UUID NOT NULL,
    "contentAssetId" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "generation" JSONB,
    "tokens" JSONB,
    "costEstimate" DOUBLE PRECISION,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "evidenceMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentGeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentGenerationEvidence" (
    "generationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,

    CONSTRAINT "ContentGenerationEvidence_pkey" PRIMARY KEY ("generationId", "responseId")
);

CREATE TABLE "DistributionTask" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "contentAssetId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "status" "DistributionTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistributionTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeoReport_runId_key" ON "GeoReport"("runId");
CREATE UNIQUE INDEX "MonitoringRun_activeSessionId_key" ON "MonitoringRun"("activeSessionId");
CREATE UNIQUE INDEX "DistributionTask_contentAssetId_platform_key" ON "DistributionTask"("contentAssetId", "platform");
CREATE INDEX "QuickStartSession_projectId_updatedAt_idx" ON "QuickStartSession"("projectId", "updatedAt");
CREATE INDEX "QuickStartSession_createdById_updatedAt_idx" ON "QuickStartSession"("createdById", "updatedAt");
CREATE INDEX "MonitoringRun_projectId_createdAt_idx" ON "MonitoringRun"("projectId", "createdAt");
CREATE INDEX "MonitoringRun_sessionId_createdAt_idx" ON "MonitoringRun"("sessionId", "createdAt");
CREATE INDEX "MonitoringRun_status_createdAt_idx" ON "MonitoringRun"("status", "createdAt");
CREATE INDEX "MonitoringResponse_runId_createdAt_idx" ON "MonitoringResponse"("runId", "createdAt");
CREATE INDEX "MonitoringResponse_queryId_idx" ON "MonitoringResponse"("queryId");
CREATE INDEX "GeoReport_projectId_createdAt_idx" ON "GeoReport"("projectId", "createdAt");
CREATE INDEX "GeoReport_brandId_createdAt_idx" ON "GeoReport"("brandId", "createdAt");
CREATE INDEX "OptimizationSuggestion_reportId_createdAt_idx" ON "OptimizationSuggestion"("reportId", "createdAt");
CREATE INDEX "SuggestionEvidence_responseId_idx" ON "SuggestionEvidence"("responseId");
CREATE INDEX "ContentAsset_projectId_updatedAt_idx" ON "ContentAsset"("projectId", "updatedAt");
CREATE INDEX "ContentAsset_reportId_createdAt_idx" ON "ContentAsset"("reportId", "createdAt");
CREATE INDEX "ContentGeneration_contentAssetId_createdAt_idx" ON "ContentGeneration"("contentAssetId", "createdAt");
CREATE INDEX "ContentGenerationEvidence_responseId_idx" ON "ContentGenerationEvidence"("responseId");
CREATE INDEX "DistributionTask_projectId_createdAt_idx" ON "DistributionTask"("projectId", "createdAt");

ALTER TABLE "QuickStartSession" ADD CONSTRAINT "QuickStartSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickStartSession" ADD CONSTRAINT "QuickStartSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickStartSession" ADD CONSTRAINT "QuickStartSession_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickStartSession" ADD CONSTRAINT "QuickStartSession_querySetId_fkey" FOREIGN KEY ("querySetId") REFERENCES "QuerySet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuickStartSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MonitoringResponse" ADD CONSTRAINT "MonitoringResponse_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringResponse" ADD CONSTRAINT "MonitoringResponse_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "Query"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoReport" ADD CONSTRAINT "GeoReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoReport" ADD CONSTRAINT "GeoReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoReport" ADD CONSTRAINT "GeoReport_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OptimizationSuggestion" ADD CONSTRAINT "OptimizationSuggestion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "GeoReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuggestionEvidence" ADD CONSTRAINT "SuggestionEvidence_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "OptimizationSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuggestionEvidence" ADD CONSTRAINT "SuggestionEvidence_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "MonitoringResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "GeoReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentGeneration" ADD CONSTRAINT "ContentGeneration_contentAssetId_fkey" FOREIGN KEY ("contentAssetId") REFERENCES "ContentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentGenerationEvidence" ADD CONSTRAINT "ContentGenerationEvidence_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ContentGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentGenerationEvidence" ADD CONSTRAINT "ContentGenerationEvidence_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "MonitoringResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistributionTask" ADD CONSTRAINT "DistributionTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DistributionTask" ADD CONSTRAINT "DistributionTask_contentAssetId_fkey" FOREIGN KEY ("contentAssetId") REFERENCES "ContentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DistributionTask" ADD CONSTRAINT "DistributionTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
