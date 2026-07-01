"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPaymentAttemptsQuerySchema = exports.paymentAttemptIdParamsSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
exports.paymentAttemptIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.listPaymentAttemptsQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z
        .enum([
        "PENDING",
        "PROCESSING",
        "SUCCEEDED",
        "FAILED",
        "REQUIRES_ACTION",
        "ABANDONED",
    ])
        .optional(),
    invoiceId: zod_1.z.uuid().optional(),
    subscriptionId: zod_1.z.uuid().optional(),
    customerId: zod_1.z.uuid().optional(),
});
