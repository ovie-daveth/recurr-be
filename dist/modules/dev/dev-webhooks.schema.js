"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateNombaWebhookSchema = void 0;
const zod_1 = require("zod");
exports.simulateNombaWebhookSchema = zod_1.z.object({
    merchantTxRef: zod_1.z.string().trim().min(1).optional(),
    orderReference: zod_1.z.string().trim().min(1).optional(),
    amountMinor: zod_1.z.number().int().positive().default(100),
    currency: zod_1.z.string().trim().toUpperCase().default("NGN"),
    eventType: zod_1.z.enum(["payment_success", "payment_failed"]).default("payment_success"),
    requestId: zod_1.z.string().trim().min(1).optional(),
    transactionId: zod_1.z.string().trim().min(1).optional(),
    cardId: zod_1.z.string().trim().min(1).optional(),
    nombaCustomerId: zod_1.z.string().trim().min(1).optional(),
    cardBrand: zod_1.z.string().trim().min(1).optional(),
    cardLast4: zod_1.z.string().trim().min(4).max(4).optional(),
    customerEmail: zod_1.z.email().optional(),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
    skipTransactionVerification: zod_1.z.boolean().default(true),
}).refine((value) => value.merchantTxRef || value.orderReference, {
    message: "Provide merchantTxRef for payment-attempt simulation or orderReference for payment-method setup simulation",
    path: ["merchantTxRef"],
});
