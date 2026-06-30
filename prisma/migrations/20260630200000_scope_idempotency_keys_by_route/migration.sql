-- AlterTable
ALTER TABLE "IdempotencyKey" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'POST';
ALTER TABLE "IdempotencyKey" ADD COLUMN "route" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "IdempotencyKey" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "IdempotencyKey" ALTER COLUMN "responseBody" DROP NOT NULL;
ALTER TABLE "IdempotencyKey" ALTER COLUMN "statusCode" DROP NOT NULL;

-- Backfill existing completed rows.
UPDATE "IdempotencyKey"
SET "completedAt" = "createdAt"
WHERE "responseBody" IS NOT NULL AND "statusCode" IS NOT NULL;

-- DropIndex
DROP INDEX "IdempotencyKey_businessId_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_businessId_method_route_key_key" ON "IdempotencyKey"("businessId", "method", "route", "key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");
