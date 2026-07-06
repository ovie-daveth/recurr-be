"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCleanupSchema = void 0;
const zod_1 = require("zod");
exports.runCleanupSchema = zod_1.z.object({
    businessId: zod_1.z.uuid().optional(),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
    stalePaymentProcessingMinutes: zod_1.z.number().int().positive().max(1440).optional(),
    staleIncompleteSubscriptionHours: zod_1.z.number().int().positive().max(720).optional(),
    idempotencyRetentionDays: zod_1.z.number().int().positive().max(365).optional(),
});
