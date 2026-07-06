-- CreateEnum
CREATE TYPE "OperationalLogSeverity" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "OperationalLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mode" "ApiKeyMode",
    "severity" "OperationalLogSeverity" NOT NULL,
    "event" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "requestId" TEXT,
    "message" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalLog_businessId_createdAt_idx" ON "OperationalLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalLog_businessId_severity_createdAt_idx" ON "OperationalLog"("businessId", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalLog_businessId_event_createdAt_idx" ON "OperationalLog"("businessId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalLog_businessId_mode_createdAt_idx" ON "OperationalLog"("businessId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalLog_businessId_entityType_entityId_idx" ON "OperationalLog"("businessId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "OperationalLog" ADD CONSTRAINT "OperationalLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
