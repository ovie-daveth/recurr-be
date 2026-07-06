"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDueDunningSchema = void 0;
const zod_1 = require("zod");
exports.runDueDunningSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    limit: zod_1.z.number().int().min(1).max(100).default(20),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
    subscriptionId: zod_1.z.uuid().optional(),
    invoiceId: zod_1.z.uuid().optional(),
    dunningAttemptId: zod_1.z.uuid().optional(),
    skipTransactionVerification: zod_1.z.boolean().default(true),
});
