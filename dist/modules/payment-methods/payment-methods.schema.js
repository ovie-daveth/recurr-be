"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupPaymentMethodCheckoutSchema = exports.setupPaymentMethodParamsSchema = void 0;
const zod_1 = require("zod");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.setupPaymentMethodParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.setupPaymentMethodCheckoutSchema = zod_1.z.object({
    callbackUrl: zod_1.z.url().optional(),
    metadata: metadataSchema,
});
