-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "diagnosisRunId" UUID NOT NULL,
    "recommendationVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "summarySnapshot" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "recommendationRunId" UUID NOT NULL,
    "recommendationType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "priorityScore" INTEGER NOT NULL,
    "impactArea" TEXT NOT NULL,
    "targetAssetType" TEXT,
    "expectedSignal" TEXT,
    "effortLevel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "competitorName" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationFinding" (
    "id" UUID NOT NULL,
    "recommendationId" UUID NOT NULL,
    "findingId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" UUID NOT NULL,
    "recommendationId" UUID NOT NULL,
    "actionType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "effortLevel" TEXT NOT NULL DEFAULT 'LOW',
    "verificationMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationRun_projectId_generatedAt_idx" ON "RecommendationRun"("projectId", "generatedAt");

-- CreateIndex
CREATE INDEX "RecommendationRun_diagnosisRunId_generatedAt_idx" ON "RecommendationRun"("diagnosisRunId", "generatedAt");

-- CreateIndex
CREATE INDEX "RecommendationRun_diagnosisRunId_recommendationVersion_idx" ON "RecommendationRun"("diagnosisRunId", "recommendationVersion");

-- CreateIndex
CREATE INDEX "Recommendation_recommendationRunId_priorityScore_idx" ON "Recommendation"("recommendationRunId", "priorityScore");

-- CreateIndex
CREATE INDEX "Recommendation_recommendationRunId_status_idx" ON "Recommendation"("recommendationRunId", "status");

-- CreateIndex
CREATE INDEX "RecommendationFinding_findingId_idx" ON "RecommendationFinding"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationFinding_recommendationId_findingId_key" ON "RecommendationFinding"("recommendationId", "findingId");

-- CreateIndex
CREATE INDEX "ActionItem_recommendationId_sortOrder_idx" ON "ActionItem"("recommendationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_diagnosisRunId_fkey" FOREIGN KEY ("diagnosisRunId") REFERENCES "DiagnosisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_recommendationRunId_fkey" FOREIGN KEY ("recommendationRunId") REFERENCES "RecommendationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFinding" ADD CONSTRAINT "RecommendationFinding_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
