-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('BUSINESS', 'INDIVIDUAL');

-- AlterEnum
ALTER TYPE "TenantStatus" ADD VALUE 'PENDING_VERIFICATION';

-- AlterTable
ALTER TABLE "Tenant"
  ADD COLUMN "type" "TenantType" NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "verificationTokenHash" TEXT,
  ADD COLUMN "verificationSentAt" TIMESTAMP(3),
  ADD COLUMN "businessName" TEXT,
  ADD COLUMN "businessRegistrationNumber" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "contactName" TEXT NOT NULL DEFAULT 'Unknown',
  ADD COLUMN "contactPhone" TEXT NOT NULL DEFAULT 'Unknown',
  ADD COLUMN "country" TEXT NOT NULL DEFAULT 'NG',
  ALTER COLUMN "status" SET DEFAULT 'PENDING_VERIFICATION';

-- Backfill existing bootstrap tenants as verified businesses so old dev data keeps working.
UPDATE "Tenant"
SET
  "type" = 'BUSINESS',
  "businessName" = "name",
  "contactName" = "name",
  "emailVerifiedAt" = COALESCE("emailVerifiedAt", CURRENT_TIMESTAMP),
  "status" = 'ACTIVE'
WHERE "emailVerifiedAt" IS NULL;

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Tenant_type_idx" ON "Tenant"("type");
