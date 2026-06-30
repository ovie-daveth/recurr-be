"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTenantEmailSchema = exports.createTenantSchema = void 0;
const zod_1 = require("zod");
const baseTenantSchema = zod_1.z.object({
    email: zod_1.z.email().toLowerCase(),
    contactName: zod_1.z.string().trim().min(2),
    contactPhone: zod_1.z.string().trim().min(5),
    country: zod_1.z.string().trim().length(2).toUpperCase().default("NG"),
    apiKeyName: zod_1.z.string().trim().min(2).default("Default API key"),
});
exports.createTenantSchema = zod_1.z.discriminatedUnion("type", [
    baseTenantSchema.extend({
        type: zod_1.z.literal("BUSINESS"),
        businessName: zod_1.z.string().trim().min(2),
        businessRegistrationNumber: zod_1.z.string().trim().min(2).optional(),
        taxId: zod_1.z.string().trim().min(2).optional(),
        website: zod_1.z.url().optional(),
    }),
    baseTenantSchema.extend({
        type: zod_1.z.literal("INDIVIDUAL"),
        legalName: zod_1.z.string().trim().min(2),
    }),
]);
exports.verifyTenantEmailSchema = zod_1.z.object({
    email: zod_1.z.email().toLowerCase(),
    token: zod_1.z.string().trim().min(16),
});
