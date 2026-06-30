"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCustomerStatusSchema = exports.updateCustomerSchema = exports.createCustomerSchema = exports.customerIdParamsSchema = void 0;
const zod_1 = require("zod");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.customerIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.createCustomerSchema = zod_1.z.object({
    email: zod_1.z.email().toLowerCase(),
    name: zod_1.z.string().trim().min(1).optional(),
    phone: zod_1.z.string().trim().min(5).optional(),
    externalReference: zod_1.z.string().trim().min(1).optional(),
    metadata: metadataSchema,
});
exports.updateCustomerSchema = exports.createCustomerSchema.partial();
exports.updateCustomerStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["ACTIVE", "DISABLED"]),
});
