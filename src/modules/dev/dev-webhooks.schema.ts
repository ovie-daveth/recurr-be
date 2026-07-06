import { z } from "zod";

export const simulateNombaWebhookSchema = z.object({
  merchantTxRef: z.string().trim().min(1).optional(),
  orderReference: z.string().trim().min(1).optional(),
  amountMinor: z.number().int().positive().default(100),
  currency: z.string().trim().toUpperCase().default("NGN"),
  eventType: z.enum(["payment_success", "payment_failed"]).default("payment_success"),
  requestId: z.string().trim().min(1).optional(),
  transactionId: z.string().trim().min(1).optional(),
  cardId: z.string().trim().min(1).optional(),
  nombaCustomerId: z.string().trim().min(1).optional(),
  cardBrand: z.string().trim().min(1).optional(),
  cardLast4: z.string().trim().min(4).max(4).optional(),
  customerEmail: z.email().optional(),
  mode: z.enum(["TEST", "LIVE"]).optional(),
  skipTransactionVerification: z.boolean().default(true),
}).refine((value) => value.merchantTxRef || value.orderReference, {
  message:
    "Provide merchantTxRef for payment-attempt simulation or orderReference for payment-method setup simulation",
  path: ["merchantTxRef"],
});
