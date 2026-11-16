"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminEmailSchema = exports.listMerchantsQuerySchema = exports.merchantApiKeyParamsSchema = exports.merchantIdParamsSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
exports.merchantIdParamsSchema = zod_1.z.object({
    merchantId: zod_1.z.uuid(),
});
exports.merchantApiKeyParamsSchema = zod_1.z.object({
    merchantId: zod_1.z.uuid(),
    businessId: zod_1.z.uuid(),
    apiKeyId: zod_1.z.uuid(),
});
exports.listMerchantsQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z
        .enum(["PENDING_VERIFICATION", "ACTIVE", "DISABLED", "DELETED"])
        .optional(),
    search: zod_1.z.string().trim().min(1).max(200).optional(),
});
exports.adminEmailSchema = zod_1.z.object({
    subject: zod_1.z
        .string()
        .trim()
        .min(3)
        .max(200)
        .refine((value) => !/[\r\n]/.test(value), "Subject must be a single line"),
    message: zod_1.z.string().trim().min(1).max(10_000),
});
