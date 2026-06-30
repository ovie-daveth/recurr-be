-- DropIndex
DROP INDEX "WebhookEvent_provider_providerEventId_key";

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_mode_providerEventId_key" ON "WebhookEvent"("provider", "mode", "providerEventId");
