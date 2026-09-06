-- CreateTable
CREATE TABLE "ContentOpportunityRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "recommendationRunId" UUID NOT NULL,
    "opportunityVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "summarySnapshot" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOpportunityRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOpportunity" (
    "id" UUID NOT NULL,
    "opportunityRunId" UUID NOT NULL,
    "opportunityType" TEXT NOT NULL,
    "titleDirection" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "priorityScore" INTEGER NOT NULL,
    "category" TEXT,
    "assetType" TEXT,
    "contentIntent" TEXT NOT NULL,
    "effortLevel" TEXT NOT NULL,
    "expectedSignals" TEXT[],
    "representativeQuery" TEXT,
    "targetQueryCount" INTEGER NOT NULL DEFAULT 0,
    "targetEngineCount" INTEGER NOT NULL DEFAULT 0,
    "targetCompetitorCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "dataQualityLimited" BOOLEAN NOT NULL DEFAULT false,
    "targetEngines" JSONB NOT NULL DEFAULT '{}',
    "targetCompetitors" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOpportunityRecommendation" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "recommendationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOpportunityRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOpportunityQuery" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "queryTextSnapshot" TEXT NOT NULL,
    "category" TEXT,
    "intent" TEXT,
    "locale" TEXT,
    "brandAbsent" BOOLEAN,
    "competitorPositive" BOOLEAN,
    "sourceEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOpportunityQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOpportunityEvidence" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "queryTextSnapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOpportunityEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOpportunityBlock" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "blockType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOpportunityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentOpportunityRun_projectId_generatedAt_idx" ON "ContentOpportunityRun"("projectId", "generatedAt");

-- CreateIndex
CREATE INDEX "ContentOpportunityRun_recommendationRunId_generatedAt_idx" ON "ContentOpportunityRun"("recommendationRunId", "generatedAt");

-- CreateIndex
CREATE INDEX "ContentOpportunityRun_recommendationRunId_opportunityVersio_idx" ON "ContentOpportunityRun"("recommendationRunId", "opportunityVersion");

-- CreateIndex
CREATE INDEX "ContentOpportunity_opportunityRunId_priorityScore_idx" ON "ContentOpportunity"("opportunityRunId", "priorityScore");

-- CreateIndex
CREATE INDEX "ContentOpportunity_opportunityRunId_status_idx" ON "ContentOpportunity"("opportunityRunId", "status");

-- CreateIndex
CREATE INDEX "ContentOpportunity_opportunityRunId_opportunityType_idx" ON "ContentOpportunity"("opportunityRunId", "opportunityType");

-- CreateIndex
CREATE INDEX "ContentOpportunityRecommendation_recommendationId_idx" ON "ContentOpportunityRecommendation"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentOpportunityRecommendation_opportunityId_recommendati_key" ON "ContentOpportunityRecommendation"("opportunityId", "recommendationId");

-- CreateIndex
CREATE INDEX "ContentOpportunityQuery_opportunityId_sortOrder_idx" ON "ContentOpportunityQuery"("opportunityId", "sortOrder");

-- CreateIndex
CREATE INDEX "ContentOpportunityEvidence_evidenceId_idx" ON "ContentOpportunityEvidence"("evidenceId");

-- CreateIndex
CREATE INDEX "ContentOpportunityEvidence_runId_idx" ON "ContentOpportunityEvidence"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentOpportunityEvidence_opportunityId_evidenceId_key" ON "ContentOpportunityEvidence"("opportunityId", "evidenceId");

-- CreateIndex
CREATE INDEX "ContentOpportunityBlock_opportunityId_sortOrder_idx" ON "ContentOpportunityBlock"("opportunityId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ContentOpportunityRun" ADD CONSTRAINT "ContentOpportunityRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunityRun" ADD CONSTRAINT "ContentOpportunityRun_recommendationRunId_fkey" FOREIGN KEY ("recommendationRunId") REFERENCES "RecommendationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunity" ADD CONSTRAINT "ContentOpportunity_opportunityRunId_fkey" FOREIGN KEY ("opportunityRunId") REFERENCES "ContentOpportunityRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunityRecommendation" ADD CONSTRAINT "ContentOpportunityRecommendation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunityRecommendation" ADD CONSTRAINT "ContentOpportunityRecommendation_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunityQuery" ADD CONSTRAINT "ContentOpportunityQuery_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunityEvidence" ADD CONSTRAINT "ContentOpportunityEvidence_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOpportunityBlock" ADD CONSTRAINT "ContentOpportunityBlock_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
