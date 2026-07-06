"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const bullmq_1 = require("bullmq");
const redis_1 = require("../lib/redis");
const prisma_1 = require("../lib/prisma");
const billing_service_1 = require("../modules/billing/billing.service");
const dunning_service_1 = require("../modules/dunning/dunning.service");
const merchant_webhooks_service_1 = require("../modules/webhook-endpoints/merchant-webhooks.service");
const queues_1 = require("./queues");
const scheduler_1 = require("./scheduler");
function workerConcurrency() {
    const value = Number(process.env.WORKER_CONCURRENCY || 2);
    return Number.isInteger(value) && value > 0 ? value : 2;
}
async function activeBusinessIds(businessId) {
    if (businessId) {
        return [businessId];
    }
    const businesses = await prisma_1.prisma.business.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
    });
    return businesses.map((business) => business.id);
}
async function processBillingJob(data) {
    const businessIds = await activeBusinessIds(data.businessId);
    const results = [];
    for (const businessId of businessIds) {
        const result = await (0, billing_service_1.runDueBilling)({
            businessId,
            mode: data.mode,
            limit: data.limit,
            skipTransactionVerification: process.env.WORKER_SKIP_TRANSACTION_VERIFICATION === "true",
        });
        results.push({ businessId, result });
    }
    return { businessCount: businessIds.length, results };
}
async function processDunningJob(data) {
    const businessIds = await activeBusinessIds(data.businessId);
    const results = [];
    for (const businessId of businessIds) {
        const result = await (0, dunning_service_1.runDueDunning)({
            businessId,
            mode: data.mode,
            limit: data.limit,
            skipTransactionVerification: process.env.WORKER_SKIP_TRANSACTION_VERIFICATION === "true",
        });
        results.push({ businessId, result });
    }
    return { businessCount: businessIds.length, results };
}
async function processWebhookJob(data) {
    const result = await (0, merchant_webhooks_service_1.runDueWebhookDeliveries)({
        businessId: data.businessId,
        endpointId: data.endpointId,
        limit: data.limit,
    });
    return result;
}
async function main() {
    const billing = (0, queues_1.billingQueue)();
    const dunning = (0, queues_1.dunningQueue)();
    const webhooks = (0, queues_1.webhookQueue)();
    const scheduler = (0, scheduler_1.scheduleRecurringJobs)({
        billingQueue: billing,
        dunningQueue: dunning,
        webhookQueue: webhooks,
    });
    const billingWorker = new bullmq_1.Worker(queues_1.BILLING_QUEUE_NAME, async (job) => processBillingJob(job.data), {
        connection: (0, redis_1.getRedisConnectionOptions)(),
        concurrency: workerConcurrency(),
    });
    const dunningWorker = new bullmq_1.Worker(queues_1.DUNNING_QUEUE_NAME, async (job) => processDunningJob(job.data), {
        connection: (0, redis_1.getRedisConnectionOptions)(),
        concurrency: workerConcurrency(),
    });
    const webhookWorker = new bullmq_1.Worker(queues_1.WEBHOOK_QUEUE_NAME, async (job) => processWebhookJob(job.data), {
        connection: (0, redis_1.getRedisConnectionOptions)(),
        concurrency: workerConcurrency(),
    });
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
    webhookWorker.on("completed", (job) => {
        console.log(`Webhook retry job ${job.id} completed`);
    });
    webhookWorker.on("failed", (job, error) => {
        console.error(`Webhook retry job ${job?.id ?? "unknown"} failed`, error);
    });
    console.log("Recurr worker started");
    async function shutdown() {
        console.log("Recurr worker shutting down");
        scheduler.stop();
        await Promise.all([
            billingWorker.close(),
            dunningWorker.close(),
            webhookWorker.close(),
            billing.close(),
            dunning.close(),
            webhooks.close(),
        ]);
        await (0, redis_1.closeRedisConnection)();
        await prisma_1.prisma.$disconnect();
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
    await (0, redis_1.closeRedisConnection)();
    await prisma_1.prisma.$disconnect();
    process.exit(1);
});
