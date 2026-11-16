CREATE TABLE "MockProviderLoadState" (
    "provider" "PaymentProvider" NOT NULL,
    "failurePoint" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockProviderLoadState_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "MockProviderLoadEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "requestLoad" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockProviderLoadEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MockProviderLoadEvent_provider_createdAt_idx"
ON "MockProviderLoadEvent"("provider", "createdAt");
