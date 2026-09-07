-- AlterTable
ALTER TABLE "BenchmarkQuery" ADD COLUMN     "builderMetadata" JSONB,
ADD COLUMN     "contamination" JSONB,
ADD COLUMN     "queryType" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "BenchmarkRun" ADD COLUMN     "targetSnapshot" JSONB;

-- AlterTable
ALTER TABLE "BenchmarkRunQuery" ADD COLUMN     "contamination" JSONB,
ADD COLUMN     "queryType" TEXT;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "entityType" TEXT NOT NULL DEFAULT 'BRAND',
ADD COLUMN     "productCategory" TEXT;

-- CreateTable
CREATE TABLE "TargetEntityAlias" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasType" TEXT NOT NULL DEFAULT 'CUSTOM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetEntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetEntityAlias_brandId_enabled_idx" ON "TargetEntityAlias"("brandId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "TargetEntityAlias_brandId_alias_key" ON "TargetEntityAlias"("brandId", "alias");

-- AddForeignKey
ALTER TABLE "TargetEntityAlias" ADD CONSTRAINT "TargetEntityAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
