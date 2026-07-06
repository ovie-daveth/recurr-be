import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { closeRedisConnection, getRedisConnectionOptions } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { runDueBilling } from "../modules/billing/billing.service";
import { runDueDunning } from "../modules/dunning/dunning.service";
import {
  BILLING_QUEUE_NAME,
  DUNNING_QUEUE_NAME,
  billingQueue,
  dunningQueue,
  type BillingRunDueJob,
  type DunningRunDueJob,
} from "./queues";
import { scheduleRecurringJobs } from "./scheduler";

function workerConcurrency() {
  const value = Number(process.env.WORKER_CONCURRENCY || 2);
  return Number.isInteger(value) && value > 0 ? value : 2;
}

async function activeBusinessIds(businessId?: string) {
  if (businessId) {
    return [businessId];
  }

  const businesses = await prisma.business.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  return businesses.map((business) => business.id);
}

async function processBillingJob(data: BillingRunDueJob) {
  const businessIds = await activeBusinessIds(data.businessId);
  const results = [];

  for (const businessId of businessIds) {
    const result = await runDueBilling({
      businessId,
      mode: data.mode,
      limit: data.limit,
      skipTransactionVerification:
        process.env.WORKER_SKIP_TRANSACTION_VERIFICATION === "true",
    });

    results.push({ businessId, result });
  }

  return { businessCount: businessIds.length, results };
}

async function processDunningJob(data: DunningRunDueJob) {
  const businessIds = await activeBusinessIds(data.businessId);
  const results = [];

  for (const businessId of businessIds) {
    const result = await runDueDunning({
      businessId,
      mode: data.mode,
      limit: data.limit,
      skipTransactionVerification:
        process.env.WORKER_SKIP_TRANSACTION_VERIFICATION === "true",
    });

    results.push({ businessId, result });
  }

  return { businessCount: businessIds.length, results };
}

async function main() {
  const billing = billingQueue();
  const dunning = dunningQueue();
  const scheduler = scheduleRecurringJobs({
    billingQueue: billing,
    dunningQueue: dunning,
  });

  const billingWorker = new Worker<BillingRunDueJob>(
    BILLING_QUEUE_NAME,
    async (job) => processBillingJob(job.data),
    {
      connection: getRedisConnectionOptions(),
      concurrency: workerConcurrency(),
    }
  );

  const dunningWorker = new Worker<DunningRunDueJob>(
    DUNNING_QUEUE_NAME,
    async (job) => processDunningJob(job.data),
    {
      connection: getRedisConnectionOptions(),
      concurrency: workerConcurrency(),
    }
  );

  billingWorker.on("completed", (job) => {
    console.log(`Billing job ${job.id} completed`);
  });
  billingWorker.on("failed", (job, error) => {
    console.error(`Billing job ${job?.id ?? "unknown"} failed`, error);
  });
  dunningWorker.on("completed", (job) => {
    console.log(`Dunning job ${job.id} completed`);
  });
  dunningWorker.on("failed", (job, error) => {
    console.error(`Dunning job ${job?.id ?? "unknown"} failed`, error);
  });

  console.log("Recurr worker started");

  async function shutdown() {
    console.log("Recurr worker shutting down");
    scheduler.stop();
    await Promise.all([
      billingWorker.close(),
      dunningWorker.close(),
      billing.close(),
      dunning.close(),
    ]);
    await closeRedisConnection();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch(async (error) => {
  console.error("Recurr worker failed to start", error);
  await closeRedisConnection();
  await prisma.$disconnect();
  process.exit(1);
});
