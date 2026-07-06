-- CreateEnum
CREATE TYPE "SubscriptionScheduleChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SubscriptionScheduleChange" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "fromPlanId" TEXT NOT NULL,
    "toPlanId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "status" "SubscriptionScheduleChangeStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionScheduleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionScheduleChange_businessId_mode_status_idx" ON "SubscriptionScheduleChange"("businessId", "mode", "status");

-- CreateIndex
CREATE INDEX "SubscriptionScheduleChange_subscriptionId_status_idx" ON "SubscriptionScheduleChange"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionScheduleChange_effectiveAt_idx" ON "SubscriptionScheduleChange"("effectiveAt");

-- AddForeignKey
ALTER TABLE "SubscriptionScheduleChange" ADD CONSTRAINT "SubscriptionScheduleChange_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionScheduleChange" ADD CONSTRAINT "SubscriptionScheduleChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionScheduleChange" ADD CONSTRAINT "SubscriptionScheduleChange_fromPlanId_fkey" FOREIGN KEY ("fromPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionScheduleChange" ADD CONSTRAINT "SubscriptionScheduleChange_toPlanId_fkey" FOREIGN KEY ("toPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
