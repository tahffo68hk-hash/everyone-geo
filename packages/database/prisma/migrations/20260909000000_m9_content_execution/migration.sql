-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('MANUAL', 'AI_ASSISTED', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('XIAOHONGSHU', 'DOUYIN', 'WEIBO', 'WECHAT', 'BAIDU', 'OTHER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'QUEUED', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('IMAGE', 'VIDEO', 'TEXT', 'OTHER');

-- CreateEnum
CREATE TYPE "ContentAuditAction" AS ENUM ('DRAFT_CREATED', 'DRAFT_UPDATED', 'REVISION_CREATED', 'SUBMITTED_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'PUBLICATION_CREATED', 'PUBLICATION_QUEUED', 'PUBLICATION_SUCCEEDED', 'PUBLICATION_FAILED', 'PUBLICATION_CANCELLED');

-- CreateEnum
CREATE TYPE "ContentUsageEventType" AS ENUM ('CONTENT_GENERATION', 'PUBLICATION_ATTEMPT');

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "generationMode" "GenerationMode" NOT NULL DEFAULT 'MANUAL',
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "body" TEXT NOT NULL,
    "summary" TEXT,
    "changeNote" TEXT,
    "generatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentApproval" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "reviewerId" UUID NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAsset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "draftId" UUID,
    "type" "AssetType" NOT NULL DEFAULT 'IMAGE',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAccountConnection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "displayName" TEXT NOT NULL,
    "credentialRef" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccountConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "title" TEXT,
    "payload" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "publisher" TEXT NOT NULL DEFAULT 'mock',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "draftId" UUID,
    "publicationId" UUID,
    "action" "ContentAuditAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentUsageEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "eventType" "ContentUsageEventType" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'none',
    "costUsd" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentDraft_organizationId_idx" ON "ContentDraft"("organizationId");

-- CreateIndex
CREATE INDEX "ContentDraft_projectId_idx" ON "ContentDraft"("projectId");

-- CreateIndex
CREATE INDEX "ContentDraft_status_idx" ON "ContentDraft"("status");

-- CreateIndex
CREATE INDEX "ContentDraft_createdById_idx" ON "ContentDraft"("createdById");

-- CreateIndex
CREATE INDEX "ContentRevision_draftId_idx" ON "ContentRevision"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRevision_draftId_version_key" ON "ContentRevision"("draftId", "version");

-- CreateIndex
CREATE INDEX "ContentApproval_draftId_idx" ON "ContentApproval"("draftId");

-- CreateIndex
CREATE INDEX "ContentApproval_revisionId_idx" ON "ContentApproval"("revisionId");

-- CreateIndex
CREATE INDEX "ContentAsset_organizationId_idx" ON "ContentAsset"("organizationId");

-- CreateIndex
CREATE INDEX "ContentAsset_projectId_idx" ON "ContentAsset"("projectId");

-- CreateIndex
CREATE INDEX "ContentAsset_draftId_idx" ON "ContentAsset"("draftId");

-- CreateIndex
CREATE INDEX "ChannelAccountConnection_organizationId_idx" ON "ChannelAccountConnection"("organizationId");

-- CreateIndex
CREATE INDEX "ChannelAccountConnection_status_idx" ON "ChannelAccountConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccountConnection_organizationId_channel_displayName_key" ON "ChannelAccountConnection"("organizationId", "channel", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_idempotencyKey_key" ON "Publication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Publication_organizationId_idx" ON "Publication"("organizationId");

-- CreateIndex
CREATE INDEX "Publication_projectId_idx" ON "Publication"("projectId");

-- CreateIndex
CREATE INDEX "Publication_draftId_idx" ON "Publication"("draftId");

-- CreateIndex
CREATE INDEX "Publication_status_idx" ON "Publication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_idempotencyKey_key" ON "PublicationAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublicationAttempt_publicationId_idx" ON "PublicationAttempt"("publicationId");

-- CreateIndex
CREATE INDEX "ContentAuditLog_organizationId_idx" ON "ContentAuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "ContentAuditLog_draftId_idx" ON "ContentAuditLog"("draftId");

-- CreateIndex
CREATE INDEX "ContentAuditLog_publicationId_idx" ON "ContentAuditLog"("publicationId");

-- CreateIndex
CREATE INDEX "ContentAuditLog_action_idx" ON "ContentAuditLog"("action");

-- CreateIndex
CREATE INDEX "ContentUsageEvent_organizationId_idx" ON "ContentUsageEvent"("organizationId");

-- CreateIndex
CREATE INDEX "ContentUsageEvent_eventType_idx" ON "ContentUsageEvent"("eventType");

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentApproval" ADD CONSTRAINT "ContentApproval_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentApproval" ADD CONSTRAINT "ContentApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ContentRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAccountConnection" ADD CONSTRAINT "ChannelAccountConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ContentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelAccountConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAuditLog" ADD CONSTRAINT "ContentAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAuditLog" ADD CONSTRAINT "ContentAuditLog_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAuditLog" ADD CONSTRAINT "ContentAuditLog_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

