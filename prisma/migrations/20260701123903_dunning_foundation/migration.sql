-- CreateEnum
CREATE TYPE "DunningAttemptStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXHAUSTED');

-- CreateTable
CREATE TABLE "DunningAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "status" "DunningAttemptStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attemptNumber" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DunningAttempt_businessId_mode_idx" ON "DunningAttempt"("businessId", "mode");

-- CreateIndex
CREATE INDEX "DunningAttempt_businessId_mode_status_idx" ON "DunningAttempt"("businessId", "mode", "status");

-- CreateIndex
CREATE INDEX "DunningAttempt_subscriptionId_idx" ON "DunningAttempt"("subscriptionId");

-- CreateIndex
CREATE INDEX "DunningAttempt_invoiceId_idx" ON "DunningAttempt"("invoiceId");

-- CreateIndex
CREATE INDEX "DunningAttempt_scheduledAt_idx" ON "DunningAttempt"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "DunningAttempt_invoiceId_attemptNumber_key" ON "DunningAttempt"("invoiceId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "DunningAttempt" ADD CONSTRAINT "DunningAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningAttempt" ADD CONSTRAINT "DunningAttempt_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningAttempt" ADD CONSTRAINT "DunningAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningAttempt" ADD CONSTRAINT "DunningAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
