"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDunningPoliciesQuerySchema = exports.dunningPolicyIdParamsSchema = exports.updateDunningPolicySchema = exports.createDunningPolicySchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
const dunningPolicyStepSchema = zod_1.z.object({
    delayMinutes: zod_1.z.number().int().positive().max(43200),
    channel: zod_1.z.string().trim().min(2).max(40).default("email"),
    metadata: metadataSchema,
});
const dunningPolicyBaseSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120),
    status: zod_1.z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
    isDefault: zod_1.z.boolean().default(true),
    finalAction: zod_1.z.enum([
        "CANCEL_SUBSCRIPTION",
        "PAUSE_SUBSCRIPTION",
        "MARK_INVOICE_UNCOLLECTIBLE",
    ]),
    steps: zod_1.z.array(dunningPolicyStepSchema).min(1).max(10),
    metadata: metadataSchema,
});
exports.createDunningPolicySchema = dunningPolicyBaseSchema.refine((value) => !(value.status === "DISABLED" && value.isDefault), {
    path: ["isDefault"],
    message: "Disabled policy cannot be the default policy",
});
exports.updateDunningPolicySchema = dunningPolicyBaseSchema
    .partial()
    .refine((value) => !(value.status === "DISABLED" && value.isDefault), {
    path: ["isDefault"],
    message: "Disabled policy cannot be the default policy",
});
exports.dunningPolicyIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.listDunningPoliciesQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["ACTIVE", "DISABLED"]).optional(),
    isDefault: zod_1.z.coerce.boolean().optional(),
});
