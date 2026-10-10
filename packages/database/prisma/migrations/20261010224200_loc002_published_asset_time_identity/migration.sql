-- AlterTable
ALTER TABLE "PublishedAsset" ADD COLUMN IF NOT EXISTS "actualPublishedAt" TIMESTAMP(3);
ALTER TABLE "PublishedAsset" ADD COLUMN IF NOT EXISTS "publicationTimeSource" TEXT;
ALTER TABLE "PublishedAsset" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PublishedAsset_actualPublishedAt_idx" ON "PublishedAsset"("actualPublishedAt");
CREATE INDEX IF NOT EXISTS "PublishedAsset_idempotencyKey_idx" ON "PublishedAsset"("idempotencyKey");
