"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBusinessesQuerySchema = exports.updateBusinessSchema = exports.createBusinessSchema = exports.businessIdParamsSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
exports.businessIdParamsSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
});
const baseBusinessSchema = zod_1.z.object({
    contactName: zod_1.z.string().trim().min(2),
    contactEmail: zod_1.z.email().toLowerCase(),
    contactPhone: zod_1.z.string().trim().min(5),
    country: zod_1.z.string().trim().length(2).toUpperCase().default("NG"),
});
exports.createBusinessSchema = zod_1.z.discriminatedUnion("type", [
    baseBusinessSchema.extend({
        type: zod_1.z.literal("BUSINESS"),
        businessName: zod_1.z.string().trim().min(2),
        businessRegistrationNumber: zod_1.z.string().trim().min(2).optional(),
        taxId: zod_1.z.string().trim().min(2).optional(),
        website: zod_1.z.url().optional(),
    }),
    baseBusinessSchema.extend({
        type: zod_1.z.literal("INDIVIDUAL"),
        legalName: zod_1.z.string().trim().min(2),
    }),
]);
exports.updateBusinessSchema = zod_1.z.object({
    type: zod_1.z.enum(["BUSINESS", "INDIVIDUAL"]).optional(),
    businessName: zod_1.z.string().trim().min(2).optional(),
    businessRegistrationNumber: zod_1.z.string().trim().min(2).optional(),
    taxId: zod_1.z.string().trim().min(2).optional(),
    website: zod_1.z.url().optional(),
    legalName: zod_1.z.string().trim().min(2).optional(),
    contactName: zod_1.z.string().trim().min(2).optional(),
    contactEmail: zod_1.z.email().toLowerCase().optional(),
    contactPhone: zod_1.z.string().trim().min(5).optional(),
    country: zod_1.z.string().trim().length(2).toUpperCase().optional(),
});
exports.listBusinessesQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"]).optional(),
});
