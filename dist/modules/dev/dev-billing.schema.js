"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fastForwardSubscriptionBillingSchema = exports.fastForwardSubscriptionParamsSchema = exports.runDueBillingSchema = void 0;
const zod_1 = require("zod");
exports.runDueBillingSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    limit: zod_1.z.number().int().min(1).max(100).default(20),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
    subscriptionId: zod_1.z.uuid().optional(),
    skipTransactionVerification: zod_1.z.boolean().default(true),
});
exports.fastForwardSubscriptionParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.fastForwardSubscriptionBillingSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    mode: zod_1.z.enum(["TEST", "LIVE"]),
    minutesAgo: zod_1.z.number().int().min(0).max(1440).default(1),
});
