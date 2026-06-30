"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantLoginSchema = exports.merchantVerifyEmailSchema = exports.merchantSignupSchema = void 0;
const zod_1 = require("zod");
const businessProfileBaseSchema = zod_1.z.object({
    email: zod_1.z.email().toLowerCase(),
    password: zod_1.z.string().min(8).max(128),
    name: zod_1.z.string().trim().min(2),
    contactName: zod_1.z.string().trim().min(2),
    contactPhone: zod_1.z.string().trim().min(5),
    country: zod_1.z.string().trim().length(2).toUpperCase().default("NG"),
});
exports.merchantSignupSchema = zod_1.z.discriminatedUnion("type", [
    businessProfileBaseSchema.extend({
        type: zod_1.z.literal("BUSINESS"),
        businessName: zod_1.z.string().trim().min(2),
        businessRegistrationNumber: zod_1.z.string().trim().min(2).optional(),
        taxId: zod_1.z.string().trim().min(2).optional(),
        website: zod_1.z.url().optional(),
    }),
    businessProfileBaseSchema.extend({
        type: zod_1.z.literal("INDIVIDUAL"),
        legalName: zod_1.z.string().trim().min(2),
    }),
]);
exports.merchantVerifyEmailSchema = zod_1.z.object({
    email: zod_1.z.email().toLowerCase(),
    token: zod_1.z.string().trim().min(16),
});
exports.merchantLoginSchema = zod_1.z.object({
    email: zod_1.z.email().toLowerCase(),
    password: zod_1.z.string().min(8).max(128),
});
