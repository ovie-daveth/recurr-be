"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlanSchema = exports.createPlanSchema = exports.planIdParamsSchema = void 0;
const zod_1 = require("zod");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.planIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.createPlanSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    code: zod_1.z.string().trim().min(2).max(80),
    amountMinor: zod_1.z.number().int().nonnegative(),
    currency: zod_1.z.string().trim().length(3).toUpperCase().default("NGN"),
    interval: zod_1.z.enum(["DAY", "WEEK", "MONTH", "YEAR", "CUSTOM"]),
    intervalCount: zod_1.z.number().int().positive().default(1),
    trialDays: zod_1.z.number().int().nonnegative().default(0),
    metadata: metadataSchema,
});
exports.updatePlanSchema = exports.createPlanSchema.partial();
