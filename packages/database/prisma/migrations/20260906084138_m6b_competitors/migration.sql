-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('DISCOVERED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompetitorType" AS ENUM ('UNKNOWN', 'DIRECT', 'ADJACENT', 'SUBSTITUTE', 'NON_COMPETITOR');

-- CreateEnum
CREATE TYPE "CompetitorSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN     "competitorSetId" UUID,
ADD COLUMN     "competitorSetVersion" TEXT;

-- CreateTable
CREATE TABLE "CompetitorCandidate" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[],
    "status" "CandidateStatus" NOT NULL DEFAULT 'DISCOVERED',
    "competitorType" "CompetitorType" NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "recommendationCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorCandidateEvidence" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "queryText" TEXT NOT NULL,
    "mentionText" TEXT NOT NULL,
    "mentionPosition" INTEGER NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorCandidateEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorSet" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "CompetitorSetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "CompetitorSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorSetEntry" (
    "id" UUID NOT NULL,
    "competitorSetId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" TEXT[],
    "competitorType" "CompetitorType" NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "CompetitorSetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorCandidate_projectId_status_idx" ON "CompetitorCandidate"("projectId", "status");

-- CreateIndex
CREATE INDEX "CompetitorCandidate_projectId_normalizedName_idx" ON "CompetitorCandidate"("projectId", "normalizedName");

-- CreateIndex
CREATE INDEX "CompetitorCandidate_projectId_updatedAt_idx" ON "CompetitorCandidate"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "CompetitorCandidateEvidence_evidenceId_idx" ON "CompetitorCandidateEvidence"("evidenceId");

-- CreateIndex
CREATE INDEX "CompetitorCandidateEvidence_runId_idx" ON "CompetitorCandidateEvidence"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorCandidateEvidence_candidateId_evidenceId_key" ON "CompetitorCandidateEvidence"("candidateId", "evidenceId");

-- CreateIndex
CREATE INDEX "CompetitorSet_projectId_status_idx" ON "CompetitorSet"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorSet_projectId_name_version_key" ON "CompetitorSet"("projectId", "name", "version");

-- CreateIndex
CREATE INDEX "CompetitorSetEntry_competitorSetId_idx" ON "CompetitorSetEntry"("competitorSetId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorSetEntry_competitorSetId_sortOrder_key" ON "CompetitorSetEntry"("competitorSetId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorSetEntry_competitorSetId_candidateId_key" ON "CompetitorSetEntry"("competitorSetId", "candidateId");

-- CreateIndex
CREATE INDEX "Analysis_competitorSetId_analysisVersion_idx" ON "Analysis"("competitorSetId", "analysisVersion");

-- AddForeignKey
ALTER TABLE "CompetitorCandidate" ADD CONSTRAINT "CompetitorCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorCandidateEvidence" ADD CONSTRAINT "CompetitorCandidateEvidence_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CompetitorCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorCandidateEvidence" ADD CONSTRAINT "CompetitorCandidateEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorCandidateEvidence" ADD CONSTRAINT "CompetitorCandidateEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorSet" ADD CONSTRAINT "CompetitorSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorSetEntry" ADD CONSTRAINT "CompetitorSetEntry_competitorSetId_fkey" FOREIGN KEY ("competitorSetId") REFERENCES "CompetitorSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
