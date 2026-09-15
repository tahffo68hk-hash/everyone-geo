-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetType" ADD VALUE 'COVER';
ALTER TYPE "AssetType" ADD VALUE 'AUDIO';

-- AlterTable
ALTER TABLE "ContentDraft" ADD COLUMN     "sourceDiagnosisId" UUID,
ADD COLUMN     "sourceOpportunityId" UUID,
ADD COLUMN     "sourceRecommendationId" UUID;

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "publishedAt" TIMESTAMP(3);

