"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupPaymentMethodCheckoutSchema = exports.listPaymentMethodsQuerySchema = exports.paymentMethodParamsSchema = exports.setupPaymentMethodParamsSchema = void 0;
const zod_1 = require("zod");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.setupPaymentMethodParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.paymentMethodParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
    paymentMethodId: zod_1.z.uuid(),
});
exports.listPaymentMethodsQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(["PENDING_SETUP", "ACTIVE", "DISABLED", "EXPIRED"]).optional(),
});
exports.setupPaymentMethodCheckoutSchema = zod_1.z.object({
    callbackUrl: zod_1.z.url().optional(),
    metadata: metadataSchema,
});
