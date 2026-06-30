-- CreateTable
CREATE TABLE "MerchantPasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPasswordResetToken_tokenHash_key" ON "MerchantPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MerchantPasswordResetToken_userId_idx" ON "MerchantPasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "MerchantPasswordResetToken_expiresAt_idx" ON "MerchantPasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "MerchantPasswordResetToken_usedAt_idx" ON "MerchantPasswordResetToken"("usedAt");

-- AddForeignKey
ALTER TABLE "MerchantPasswordResetToken" ADD CONSTRAINT "MerchantPasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MerchantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
