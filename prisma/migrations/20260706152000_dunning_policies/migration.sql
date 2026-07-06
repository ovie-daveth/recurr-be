-- CreateEnum
CREATE TYPE "DunningPolicyStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DunningFinalAction" AS ENUM ('CANCEL_SUBSCRIPTION', 'PAUSE_SUBSCRIPTION', 'MARK_INVOICE_UNCOLLECTIBLE');

-- CreateTable
CREATE TABLE "DunningPolicy" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "name" TEXT NOT NULL,
    "status" "DunningPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "finalAction" "DunningFinalAction" NOT NULL DEFAULT 'PAUSE_SUBSCRIPTION',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningPolicyStep" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningPolicyStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DunningPolicy_businessId_mode_status_idx" ON "DunningPolicy"("businessId", "mode", "status");

-- CreateIndex
CREATE INDEX "DunningPolicy_businessId_mode_isDefault_idx" ON "DunningPolicy"("businessId", "mode", "isDefault");

-- CreateIndex
CREATE INDEX "DunningPolicyStep_policyId_idx" ON "DunningPolicyStep"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "DunningPolicyStep_policyId_attemptNumber_key" ON "DunningPolicyStep"("policyId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "DunningPolicy" ADD CONSTRAINT "DunningPolicy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningPolicyStep" ADD CONSTRAINT "DunningPolicyStep_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DunningPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
