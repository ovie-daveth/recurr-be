"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWebhookDeliveriesQuerySchema = exports.listWebhookEndpointsQuerySchema = exports.createWebhookEndpointSchema = exports.webhookEndpointIdParamsSchema = exports.merchantWebhookEvents = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
exports.merchantWebhookEvents = [
    "*",
    "customer.created",
    "plan.created",
    "subscription.created",
    "subscription.trialing",
    "subscription.active",
    "subscription.past_due",
    "subscription.cancelled",
    "invoice.created",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "payment_method.updated",
    "dunning.retry_scheduled",
    "dunning.exhausted",
];
exports.webhookEndpointIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.createWebhookEndpointSchema = zod_1.z.object({
    url: zod_1.z.url(),
    description: zod_1.z.string().trim().max(255).optional(),
    events: zod_1.z.array(zod_1.z.enum(exports.merchantWebhookEvents)).min(1).default(["*"]),
});
exports.listWebhookEndpointsQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["ACTIVE", "DISABLED"]).optional(),
});
exports.listWebhookDeliveriesQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["PENDING", "DELIVERED", "FAILED", "RETRYING"]).optional(),
    eventType: zod_1.z.string().trim().optional(),
});
