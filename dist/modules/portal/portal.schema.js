"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portalChangePlanSchema = exports.portalCancelSubscriptionSchema = exports.portalPaymentMethodSetupSchema = exports.portalInvoicePaySchema = exports.listPortalSessionsQuerySchema = exports.portalSessionIdParamsSchema = exports.portalSubscriptionActionParamsSchema = exports.portalInvoicePayParamsSchema = exports.portalSessionTokenParamsSchema = exports.createPortalSessionSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.createPortalSessionSchema = zod_1.z.object({
    customerId: zod_1.z.uuid(),
    returnUrl: zod_1.z.url().optional(),
    expiresInMinutes: zod_1.z.coerce.number().int().min(5).max(1440).default(60),
    metadata: metadataSchema,
});
exports.portalSessionTokenParamsSchema = zod_1.z.object({
    token: zod_1.z.string().trim().min(16),
});
exports.portalInvoicePayParamsSchema = exports.portalSessionTokenParamsSchema.extend({
    invoiceId: zod_1.z.uuid(),
});
exports.portalSubscriptionActionParamsSchema = exports.portalSessionTokenParamsSchema.extend({
    subscriptionId: zod_1.z.uuid(),
});
exports.portalSessionIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.listPortalSessionsQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
    customerId: zod_1.z.uuid().optional(),
});
exports.portalInvoicePaySchema = zod_1.z.object({
    metadata: metadataSchema,
});
exports.portalPaymentMethodSetupSchema = zod_1.z.object({
    callbackUrl: zod_1.z.url().optional(),
    subscriptionId: zod_1.z.uuid().optional(),
    metadata: metadataSchema,
});
exports.portalCancelSubscriptionSchema = zod_1.z.object({
    cancelAtPeriodEnd: zod_1.z.boolean().default(true),
});
exports.portalChangePlanSchema = zod_1.z.object({
    newPlanId: zod_1.z.uuid(),
    effective: zod_1.z.enum(["IMMEDIATE", "PERIOD_END"]).default("IMMEDIATE"),
    prorationBehavior: zod_1.z.enum(["CREATE_PRORATION", "NONE"]).default("CREATE_PRORATION"),
    metadata: metadataSchema,
});
