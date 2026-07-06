"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEANUP_QUEUE_NAME = exports.WEBHOOK_QUEUE_NAME = exports.DUNNING_QUEUE_NAME = exports.BILLING_QUEUE_NAME = void 0;
exports.billingQueue = billingQueue;
exports.dunningQueue = dunningQueue;
exports.webhookQueue = webhookQueue;
exports.cleanupQueue = cleanupQueue;
const bullmq_1 = require("bullmq");
const redis_1 = require("../lib/redis");
exports.BILLING_QUEUE_NAME = "recurr-billing";
exports.DUNNING_QUEUE_NAME = "recurr-dunning";
exports.WEBHOOK_QUEUE_NAME = "recurr-webhooks";
exports.CLEANUP_QUEUE_NAME = "recurr-cleanup";
function billingQueue() {
    return new bullmq_1.Queue(exports.BILLING_QUEUE_NAME, {
        connection: (0, redis_1.getRedisConnectionOptions)(),
    });
}
function dunningQueue() {
    return new bullmq_1.Queue(exports.DUNNING_QUEUE_NAME, {
        connection: (0, redis_1.getRedisConnectionOptions)(),
    });
}
function webhookQueue() {
    return new bullmq_1.Queue(exports.WEBHOOK_QUEUE_NAME, {
        connection: (0, redis_1.getRedisConnectionOptions)(),
    });
}
function cleanupQueue() {
    return new bullmq_1.Queue(exports.CLEANUP_QUEUE_NAME, {
        connection: (0, redis_1.getRedisConnectionOptions)(),
    });
}
