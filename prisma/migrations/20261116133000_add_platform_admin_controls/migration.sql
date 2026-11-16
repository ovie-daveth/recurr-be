ALTER TABLE "MerchantUser"
ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "MerchantUser_deletedAt_idx" ON "MerchantUser"("deletedAt");

CREATE TABLE "AdminActionLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminActionLog_actorUserId_createdAt_idx"
ON "AdminActionLog"("actorUserId", "createdAt");

CREATE INDEX "AdminActionLog_targetUserId_createdAt_idx"
ON "AdminActionLog"("targetUserId", "createdAt");

ALTER TABLE "AdminActionLog"
ADD CONSTRAINT "AdminActionLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "MerchantUser"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminActionLog"
ADD CONSTRAINT "AdminActionLog_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "MerchantUser"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
