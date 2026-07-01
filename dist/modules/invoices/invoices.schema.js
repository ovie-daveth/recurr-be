"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payInvoiceSchema = exports.listInvoicesQuerySchema = exports.invoiceIdParamsSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.invoiceIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.listInvoicesQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z
        .enum([
        "DRAFT",
        "OPEN",
        "PAYMENT_PROCESSING",
        "PAID",
        "PAYMENT_FAILED",
        "VOID",
        "UNCOLLECTIBLE",
    ])
        .optional(),
    subscriptionId: zod_1.z.uuid().optional(),
    customerId: zod_1.z.uuid().optional(),
});
exports.payInvoiceSchema = zod_1.z
    .object({
    metadata: metadataSchema,
})
    .default({});
