"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelSubscriptionSchema = exports.listSubscriptionsQuerySchema = exports.createSubscriptionSchema = exports.subscriptionIdParamsSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.subscriptionIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.createSubscriptionSchema = zod_1.z.object({
    customerId: zod_1.z.uuid(),
    planId: zod_1.z.uuid(),
    paymentMethodId: zod_1.z.uuid(),
    trialDays: zod_1.z.number().int().nonnegative().max(365).optional(),
    metadata: metadataSchema,
});
exports.listSubscriptionsQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z
        .enum([
        "INCOMPLETE",
        "TRIALING",
        "ACTIVE",
        "PAST_DUE",
        "PAUSED",
        "CANCELLED",
        "EXPIRED",
    ])
        .optional(),
});
exports.cancelSubscriptionSchema = zod_1.z.object({
    cancelAtPeriodEnd: zod_1.z.boolean().default(false),
});
