-- AlterTable
ALTER TABLE "OptimizationExperiment" ADD COLUMN     "measurementMode" TEXT,
ADD COLUMN     "measurementValidity" TEXT,
ADD COLUMN     "measurementWarnings" JSONB;

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAsset" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "assetType" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'KNOWN',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "lastObservedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAssetSnapshot" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "snapshotType" TEXT NOT NULL DEFAULT 'OBSERVED',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "title" TEXT,
    "textSnapshot" TEXT,
    "textLength" INTEGER,
    "headings" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAssetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityAssetMapping" (
    "id" UUID NOT NULL,
    "contentOpportunityId" UUID NOT NULL,
    "siteAssetId" UUID,
    "mappingType" TEXT NOT NULL,
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityAssetMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationChangePlan" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "contentOpportunityId" UUID NOT NULL,
    "siteAssetId" UUID,
    "changePlanVersion" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationChangePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationChangeItem" (
    "id" UUID NOT NULL,
    "changePlanId" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceRecommendationId" UUID,
    "sourceFindingId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationChangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotReview" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "reviewVersion" TEXT NOT NULL,
    "measurementValidity" TEXT NOT NULL,
    "measurementMode" TEXT,
    "executionValidity" TEXT NOT NULL,
    "comparisonValidity" TEXT NOT NULL,
    "observedOutcome" TEXT NOT NULL,
    "attributionConfidence" TEXT NOT NULL,
    "changedAssetCited" BOOLEAN,
    "retrievalObservedForChangedAsset" TEXT,
    "evaluationId" UUID,
    "lessons" JSONB NOT NULL DEFAULT '{}',
    "summarySnapshot" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_projectId_status_idx" ON "Site"("projectId", "status");

-- CreateIndex
CREATE INDEX "SiteAsset_siteId_status_idx" ON "SiteAsset"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAsset_siteId_canonicalUrl_key" ON "SiteAsset"("siteId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "SiteAssetSnapshot_assetId_capturedAt_idx" ON "SiteAssetSnapshot"("assetId", "capturedAt");

-- CreateIndex
CREATE INDEX "OpportunityAssetMapping_contentOpportunityId_idx" ON "OpportunityAssetMapping"("contentOpportunityId");

-- CreateIndex
CREATE INDEX "OpportunityAssetMapping_siteAssetId_idx" ON "OpportunityAssetMapping"("siteAssetId");

-- CreateIndex
CREATE INDEX "OptimizationChangePlan_projectId_createdAt_idx" ON "OptimizationChangePlan"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "OptimizationChangePlan_contentOpportunityId_idx" ON "OptimizationChangePlan"("contentOpportunityId");

-- CreateIndex
CREATE INDEX "OptimizationChangePlan_siteAssetId_idx" ON "OptimizationChangePlan"("siteAssetId");

-- CreateIndex
CREATE INDEX "OptimizationChangeItem_changePlanId_sortOrder_idx" ON "OptimizationChangeItem"("changePlanId", "sortOrder");

-- CreateIndex
CREATE INDEX "PilotReview_experimentId_generatedAt_idx" ON "PilotReview"("experimentId", "generatedAt");

-- CreateIndex
CREATE INDEX "PilotReview_experimentId_reviewVersion_idx" ON "PilotReview"("experimentId", "reviewVersion");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAsset" ADD CONSTRAINT "SiteAsset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssetSnapshot" ADD CONSTRAINT "SiteAssetSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SiteAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAssetMapping" ADD CONSTRAINT "OpportunityAssetMapping_contentOpportunityId_fkey" FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAssetMapping" ADD CONSTRAINT "OpportunityAssetMapping_siteAssetId_fkey" FOREIGN KEY ("siteAssetId") REFERENCES "SiteAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationChangePlan" ADD CONSTRAINT "OptimizationChangePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationChangePlan" ADD CONSTRAINT "OptimizationChangePlan_contentOpportunityId_fkey" FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationChangePlan" ADD CONSTRAINT "OptimizationChangePlan_siteAssetId_fkey" FOREIGN KEY ("siteAssetId") REFERENCES "SiteAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationChangeItem" ADD CONSTRAINT "OptimizationChangeItem_changePlanId_fkey" FOREIGN KEY ("changePlanId") REFERENCES "OptimizationChangePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotReview" ADD CONSTRAINT "PilotReview_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
