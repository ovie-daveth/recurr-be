"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPublicSubscriptionSchema = exports.publicSubscribeQuerySchema = exports.publicSubscribeParamsSchema = void 0;
const zod_1 = require("zod");
exports.publicSubscribeParamsSchema = zod_1.z.object({
    businessSlug: zod_1.z.string().trim().min(2),
    planCode: zod_1.z.string().trim().min(1),
});
exports.publicSubscribeQuerySchema = zod_1.z.object({
    mode: zod_1.z.enum(["TEST", "LIVE"]).default("TEST"),
});
exports.startPublicSubscriptionSchema = zod_1.z.object({
    mode: zod_1.z.enum(["TEST", "LIVE"]).default("TEST"),
    email: zod_1.z.email(),
    name: zod_1.z.string().trim().min(2).max(120).optional(),
    phone: zod_1.z.string().trim().max(40).optional(),
    externalReference: zod_1.z.string().trim().max(120).optional(),
    callbackUrl: zod_1.z.url().optional(),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
