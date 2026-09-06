-- CreateTable
CREATE TABLE "OptimizationExperiment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "contentOpportunityId" UUID NOT NULL,
    "experimentVersion" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "baselineReportId" UUID NOT NULL,
    "querySetFingerprint" TEXT NOT NULL,
    "metricSource" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "engineId" UUID,
    "engineKey" TEXT,
    "engineName" TEXT,
    "requestedModel" TEXT,
    "responseModel" TEXT,
    "analysisVersion" TEXT NOT NULL,
    "competitorSetVersion" TEXT,
    "suiteName" TEXT,
    "suiteVersion" TEXT,
    "plannedQueryCount" INTEGER NOT NULL DEFAULT 0,
    "executionRecordedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentExecution" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "executionType" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "assetType" TEXT,
    "assetReference" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentRetest" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "benchmarkRunId" UUID,
    "reportId" UUID,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "runType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "engineId" UUID,
    "engineKey" TEXT,
    "requestedModel" TEXT,
    "plannedQueryCount" INTEGER NOT NULL,
    "expectedCallCount" INTEGER NOT NULL,
    "querySetFingerprint" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentRetest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentEvaluation" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "retestId" UUID NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "beforeReportId" UUID NOT NULL,
    "afterReportId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "compatibility" JSONB NOT NULL DEFAULT '{}',
    "summarySnapshot" JSONB NOT NULL DEFAULT '{}',
    "metricSource" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentMetricDelta" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "metricName" TEXT NOT NULL,
    "beforeValue" DOUBLE PRECISION,
    "afterValue" DOUBLE PRECISION,
    "deltaValue" DOUBLE PRECISION,
    "deltaUnit" TEXT NOT NULL,
    "direction" TEXT,
    "meaningful" TEXT NOT NULL,
    "primarySignal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentMetricDelta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentQueryDelta" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "queryTextSnapshot" TEXT NOT NULL,
    "category" TEXT,
    "beforeEvidenceId" UUID,
    "afterEvidenceId" UUID,
    "beforeMentioned" BOOLEAN,
    "afterMentioned" BOOLEAN,
    "beforeRecommended" BOOLEAN,
    "afterRecommended" BOOLEAN,
    "beforePosition" INTEGER,
    "afterPosition" INTEGER,
    "beforeCitationCount" INTEGER NOT NULL DEFAULT -1,
    "afterCitationCount" INTEGER NOT NULL DEFAULT -1,
    "transitionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EVALUATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentQueryDelta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OptimizationExperiment_projectId_createdAt_idx" ON "OptimizationExperiment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "OptimizationExperiment_contentOpportunityId_createdAt_idx" ON "OptimizationExperiment"("contentOpportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "OptimizationExperiment_baselineReportId_idx" ON "OptimizationExperiment"("baselineReportId");

-- CreateIndex
CREATE INDEX "OptimizationExperiment_status_idx" ON "OptimizationExperiment"("status");

-- CreateIndex
CREATE INDEX "ExperimentExecution_experimentId_executedAt_idx" ON "ExperimentExecution"("experimentId", "executedAt");

-- CreateIndex
CREATE INDEX "ExperimentRetest_experimentId_sequence_idx" ON "ExperimentRetest"("experimentId", "sequence");

-- CreateIndex
CREATE INDEX "ExperimentRetest_experimentId_status_idx" ON "ExperimentRetest"("experimentId", "status");

-- CreateIndex
CREATE INDEX "ExperimentEvaluation_experimentId_generatedAt_idx" ON "ExperimentEvaluation"("experimentId", "generatedAt");

-- CreateIndex
CREATE INDEX "ExperimentEvaluation_retestId_evaluationVersion_idx" ON "ExperimentEvaluation"("retestId", "evaluationVersion");

-- CreateIndex
CREATE INDEX "ExperimentMetricDelta_evaluationId_idx" ON "ExperimentMetricDelta"("evaluationId");

-- CreateIndex
CREATE INDEX "ExperimentQueryDelta_evaluationId_sortOrder_idx" ON "ExperimentQueryDelta"("evaluationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "OptimizationExperiment" ADD CONSTRAINT "OptimizationExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationExperiment" ADD CONSTRAINT "OptimizationExperiment_contentOpportunityId_fkey" FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentExecution" ADD CONSTRAINT "ExperimentExecution_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentRetest" ADD CONSTRAINT "ExperimentRetest_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentEvaluation" ADD CONSTRAINT "ExperimentEvaluation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentMetricDelta" ADD CONSTRAINT "ExperimentMetricDelta_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "ExperimentEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentQueryDelta" ADD CONSTRAINT "ExperimentQueryDelta_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "ExperimentEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
