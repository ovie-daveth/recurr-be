-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'DISABLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'BANK_ACCOUNT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('NOMBA');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAYMENT_PROCESSING', 'PAID', 'PAYMENT_FAILED', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REQUIRES_ACTION', 'ABANDONED');

-- AlterTable
ALTER TABLE "IdempotencyKey" ALTER COLUMN "method" DROP DEFAULT,
ALTER COLUMN "route" DROP DEFAULT;

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'NOMBA',
    "type" "PaymentMethodType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "providerSetupReference" TEXT,
    "providerCustomerReference" TEXT,
    "providerPaymentMethodReference" TEXT,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextBillingAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "amountDueMinor" INTEGER NOT NULL,
    "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "mode" "ApiKeyMode" NOT NULL DEFAULT 'TEST',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'NOMBA',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "failureReason" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethod_businessId_mode_idx" ON "PaymentMethod"("businessId", "mode");

-- CreateIndex
CREATE INDEX "PaymentMethod_customerId_status_idx" ON "PaymentMethod"("customerId", "status");

-- CreateIndex
CREATE INDEX "PaymentMethod_provider_providerSetupReference_idx" ON "PaymentMethod"("provider", "providerSetupReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_businessId_mode_provider_providerSetupReferen_key" ON "PaymentMethod"("businessId", "mode", "provider", "providerSetupReference");

-- CreateIndex
CREATE INDEX "Subscription_businessId_mode_idx" ON "Subscription"("businessId", "mode");

-- CreateIndex
CREATE INDEX "Subscription_businessId_mode_status_idx" ON "Subscription"("businessId", "mode", "status");

-- CreateIndex
CREATE INDEX "Subscription_customerId_status_idx" ON "Subscription"("customerId", "status");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE INDEX "Subscription_nextBillingAt_idx" ON "Subscription"("nextBillingAt");

-- CreateIndex
CREATE INDEX "Invoice_businessId_mode_idx" ON "Invoice"("businessId", "mode");

-- CreateIndex
CREATE INDEX "Invoice_businessId_mode_status_idx" ON "Invoice"("businessId", "mode", "status");

-- CreateIndex
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_dueAt_idx" ON "Invoice"("dueAt");

-- CreateIndex
CREATE INDEX "InvoiceItem_businessId_idx" ON "InvoiceItem"("businessId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_subscriptionId_idx" ON "InvoiceItem"("subscriptionId");

-- CreateIndex
CREATE INDEX "InvoiceItem_planId_idx" ON "InvoiceItem"("planId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_mode_idx" ON "PaymentAttempt"("businessId", "mode");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_mode_status_idx" ON "PaymentAttempt"("businessId", "mode", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_subscriptionId_idx" ON "PaymentAttempt"("subscriptionId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_invoiceId_idx" ON "PaymentAttempt"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_customerId_idx" ON "PaymentAttempt"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_invoiceId_attemptNumber_key" ON "PaymentAttempt"("invoiceId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerReference_key" ON "PaymentAttempt"("provider", "providerReference");

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
