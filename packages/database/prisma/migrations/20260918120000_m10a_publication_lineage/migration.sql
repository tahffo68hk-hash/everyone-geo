-- Migration: 20260918120000_m10a_publication_lineage

-- 1. Alter Publication to add lineage references
ALTER TABLE "Publication" ADD COLUMN IF NOT EXISTS "campaignId" UUID REFERENCES content_campaigns(id) ON DELETE SET NULL;
ALTER TABLE "Publication" ADD COLUMN IF NOT EXISTS "scheduleItemId" UUID REFERENCES content_schedule_items(id) ON DELETE SET NULL;
ALTER TABLE "Publication" ADD COLUMN IF NOT EXISTS "planItemId" UUID REFERENCES content_plan_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Publication_campaignId_idx" ON "Publication"("campaignId");
CREATE INDEX IF NOT EXISTS "Publication_scheduleItemId_idx" ON "Publication"("scheduleItemId");
CREATE INDEX IF NOT EXISTS "Publication_planItemId_idx" ON "Publication"("planItemId");

-- 2. Alter PublicationAttempt to add lineage references
ALTER TABLE "PublicationAttempt" ADD COLUMN IF NOT EXISTS "campaignId" UUID REFERENCES content_campaigns(id) ON DELETE SET NULL;
ALTER TABLE "PublicationAttempt" ADD COLUMN IF NOT EXISTS "scheduleItemId" UUID REFERENCES content_schedule_items(id) ON DELETE SET NULL;
ALTER TABLE "PublicationAttempt" ADD COLUMN IF NOT EXISTS "planItemId" UUID REFERENCES content_plan_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "PublicationAttempt_campaignId_idx" ON "PublicationAttempt"("campaignId");
CREATE INDEX IF NOT EXISTS "PublicationAttempt_scheduleItemId_idx" ON "PublicationAttempt"("scheduleItemId");
CREATE INDEX IF NOT EXISTS "PublicationAttempt_planItemId_idx" ON "PublicationAttempt"("planItemId");

-- 3. Create PublishedAsset table
CREATE TABLE IF NOT EXISTS "PublishedAsset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "projectId" UUID NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
    "publicationId" UUID REFERENCES "Publication"("id") ON DELETE SET NULL,
    "publicationAttemptId" UUID REFERENCES "PublicationAttempt"("id") ON DELETE SET NULL,
    "campaignId" UUID REFERENCES content_campaigns(id) ON DELETE SET NULL,
    "scheduleItemId" UUID REFERENCES content_schedule_items(id) ON DELETE SET NULL,
    "planItemId" UUID REFERENCES content_plan_items(id) ON DELETE SET NULL,
    "draftId" UUID NOT NULL REFERENCES "ContentDraft"("id") ON DELETE RESTRICT,
    "revisionId" UUID NOT NULL REFERENCES "ContentRevision"("id") ON DELETE RESTRICT,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "externalAssetId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceType" TEXT NOT NULL DEFAULT 'PLATFORM_PUBLISH',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "verificationNote" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishedAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PublishedAsset_organizationId_idx" ON "PublishedAsset"("organizationId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_projectId_idx" ON "PublishedAsset"("projectId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_campaignId_idx" ON "PublishedAsset"("campaignId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_planItemId_idx" ON "PublishedAsset"("planItemId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_scheduleItemId_idx" ON "PublishedAsset"("scheduleItemId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_draftId_idx" ON "PublishedAsset"("draftId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_publicationId_idx" ON "PublishedAsset"("publicationId");
CREATE INDEX IF NOT EXISTS "PublishedAsset_platform_idx" ON "PublishedAsset"("platform");
CREATE INDEX IF NOT EXISTS "PublishedAsset_verificationStatus_idx" ON "PublishedAsset"("verificationStatus");
