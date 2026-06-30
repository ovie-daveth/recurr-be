-- CreateTable
CREATE TABLE "MerchantSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedFromSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSession_refreshTokenHash_key" ON "MerchantSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "MerchantSession_userId_idx" ON "MerchantSession"("userId");

-- CreateIndex
CREATE INDEX "MerchantSession_expiresAt_idx" ON "MerchantSession"("expiresAt");

-- CreateIndex
CREATE INDEX "MerchantSession_revokedAt_idx" ON "MerchantSession"("revokedAt");

-- AddForeignKey
ALTER TABLE "MerchantSession" ADD CONSTRAINT "MerchantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MerchantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
