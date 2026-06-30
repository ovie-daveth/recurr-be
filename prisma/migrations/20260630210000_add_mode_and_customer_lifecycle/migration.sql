-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST';
ALTER TABLE "Customer" ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST';

-- DropIndex
DROP INDEX "Plan_businessId_code_key";

-- DropIndex
DROP INDEX "Customer_businessId_email_key";

-- DropIndex
DROP INDEX "Customer_businessId_externalReference_key";

-- CreateIndex
CREATE UNIQUE INDEX "Plan_businessId_mode_code_key" ON "Plan"("businessId", "mode", "code");

-- CreateIndex
CREATE INDEX "Plan_businessId_mode_idx" ON "Plan"("businessId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_mode_email_key" ON "Customer"("businessId", "mode", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_mode_externalReference_key" ON "Customer"("businessId", "mode", "externalReference");

-- CreateIndex
CREATE INDEX "Customer_businessId_mode_idx" ON "Customer"("businessId", "mode");

-- CreateIndex
CREATE INDEX "Customer_businessId_status_idx" ON "Customer"("businessId", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_mode_idx" ON "WebhookEvent"("provider", "mode");
