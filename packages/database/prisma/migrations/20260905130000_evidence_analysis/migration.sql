-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('official_api', 'browser', 'third_party_api', 'manual', 'estimated', 'mock');

-- CreateEnum
CREATE TYPE "RetrievalMode" AS ENUM ('api_plain', 'api_web_search', 'official_web_ui', 'browser_agent', 'manual_verified', 'unknown');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('positive', 'neutral', 'negative', 'unknown');

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "analysisAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "analysisErrorCode" TEXT,
ADD COLUMN     "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "queryText" TEXT NOT NULL,
    "rawPrompt" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "engineKey" TEXT NOT NULL,
    "engineName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT,
    "retrievalMode" "RetrievalMode" NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "metadata" JSONB NOT NULL,
    "entitySnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "brandMentioned" BOOLEAN NOT NULL,
    "mentionPosition" INTEGER,
    "recommended" BOOLEAN NOT NULL,
    "sentiment" "Sentiment" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "context" TEXT NOT NULL,
    "sentiment" "Sentiment" NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" UUID NOT NULL,
    "analysisId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_runId_key" ON "Evidence"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_evidenceId_analysisVersion_key" ON "Analysis"("evidenceId", "analysisVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_analysisId_entityType_entityId_key" ON "Mention"("analysisId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Citation_analysisId_url_key" ON "Citation"("analysisId", "url");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw observations are append-only, including through direct SQL/Prisma writes.
CREATE FUNCTION reject_evidence_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Raw Evidence is immutable; append an Analysis version instead' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER evidence_immutable BEFORE UPDATE ON "Evidence"
FOR EACH ROW EXECUTE FUNCTION reject_evidence_update();
