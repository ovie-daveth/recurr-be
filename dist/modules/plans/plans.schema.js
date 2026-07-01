"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPlansQuerySchema = exports.updatePlanSchema = exports.createPlanSchema = exports.planIdParamsSchema = void 0;
const zod_1 = require("zod");
const money_1 = require("../../lib/money");
const pagination_1 = require("../../lib/pagination");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.planIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
const planBaseSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    code: zod_1.z.string().trim().min(2).max(80),
    amountMinor: zod_1.z.number().int().positive(),
    currency: money_1.supportedCurrencySchema.default("NGN"),
    interval: zod_1.z.enum(["DAY", "WEEK", "MONTH", "YEAR", "CUSTOM"]),
    intervalCount: zod_1.z.number().int().positive().default(1),
    trialDays: zod_1.z.number().int().nonnegative().default(0),
    metadata: metadataSchema,
});
exports.createPlanSchema = planBaseSchema.refine(money_1.validateAmountMinorForCurrency, {
    path: ["amountMinor"],
    message: (0, money_1.moneyLimitMessage)(),
});
exports.updatePlanSchema = planBaseSchema.partial().refine(money_1.validateAmountMinorForCurrency, {
    path: ["amountMinor"],
    message: (0, money_1.moneyLimitMessage)(),
});
exports.listPlansQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
});
