"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleRecurringJobs = scheduleRecurringJobs;
function intervalMs(envName, fallback) {
    const value = Number(process.env[envName]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}
function scheduleRecurringJobs(input) {
    const billingInterval = intervalMs("WORKER_BILLING_INTERVAL_MS", 60_000);
    const dunningInterval = intervalMs("WORKER_DUNNING_INTERVAL_MS", 60_000);
    const webhookInterval = intervalMs("WORKER_WEBHOOK_INTERVAL_MS", 60_000);
    const mode = process.env.WORKER_DEFAULT_MODE === "LIVE" ||
        process.env.WORKER_DEFAULT_MODE === "TEST"
        ? process.env.WORKER_DEFAULT_MODE
        : undefined;
    const limit = Number(process.env.WORKER_RUN_LIMIT || 50);
    const jobLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const timers = [
        setInterval(() => {
            void input.billingQueue.add("billing.runDue", { mode, limit: jobLimit }, {
                removeOnComplete: 100,
                removeOnFail: 500,
            });
        }, billingInterval),
        setInterval(() => {
            void input.dunningQueue.add("dunning.runDue", { mode, limit: jobLimit }, {
                removeOnComplete: 100,
                removeOnFail: 500,
            });
        }, dunningInterval),
        setInterval(() => {
            void input.webhookQueue.add("webhook.runDue", { limit: jobLimit }, {
                removeOnComplete: 100,
                removeOnFail: 500,
            });
        }, webhookInterval),
    ];
    void input.billingQueue.add("billing.runDue", { mode, limit: jobLimit });
    void input.dunningQueue.add("dunning.runDue", { mode, limit: jobLimit });
    void input.webhookQueue.add("webhook.runDue", { limit: jobLimit });
    return {
        stop() {
            timers.forEach((timer) => clearInterval(timer));
        },
    };
}
