CREATE TYPE "MockLoadTestRunStatus" AS ENUM ('RUNNING', 'COMPLETED');

CREATE TABLE "MockLoadTestRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "targetRate" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "status" "MockLoadTestRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockLoadTestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MockLoadTestResponse" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vu" INTEGER,
    "iteration" INTEGER,
    "status" INTEGER NOT NULL,
    "durationMs" DOUBLE PRECISION NOT NULL,
    "requestId" TEXT,
    "provider" TEXT,
    "preferredProvider" TEXT,
    "selectedProvider" TEXT,
    "unavailableProviders" JSONB NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "MockLoadTestResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MockLoadTestRun_businessId_startedAt_idx"
ON "MockLoadTestRun"("businessId", "startedAt");

CREATE INDEX "MockLoadTestRun_status_startedAt_idx"
ON "MockLoadTestRun"("status", "startedAt");

CREATE INDEX "MockLoadTestResponse_runId_timestamp_idx"
ON "MockLoadTestResponse"("runId", "timestamp");

ALTER TABLE "MockLoadTestRun"
ADD CONSTRAINT "MockLoadTestRun_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MockLoadTestResponse"
ADD CONSTRAINT "MockLoadTestResponse_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "MockLoadTestRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
