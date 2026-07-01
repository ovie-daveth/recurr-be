"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateNombaWebhookSchema = void 0;
const zod_1 = require("zod");
exports.simulateNombaWebhookSchema = zod_1.z.object({
    merchantTxRef: zod_1.z.string().trim().min(1),
    amountMinor: zod_1.z.number().int().positive(),
    currency: zod_1.z.string().trim().toUpperCase().default("NGN"),
    eventType: zod_1.z.enum(["payment_success", "payment_failed"]).default("payment_success"),
    orderReference: zod_1.z.string().trim().min(1).optional(),
    requestId: zod_1.z.string().trim().min(1).optional(),
    transactionId: zod_1.z.string().trim().min(1).optional(),
    customerEmail: zod_1.z.email().optional(),
    mode: zod_1.z.enum(["TEST", "LIVE"]).default("TEST"),
    skipTransactionVerification: zod_1.z.boolean().default(true),
});
