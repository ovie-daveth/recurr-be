import { z } from "zod";

export const simulateNombaWebhookSchema = z.object({
  merchantTxRef: z.string().trim().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().trim().toUpperCase().default("NGN"),
  eventType: z.enum(["payment_success", "payment_failed"]).default("payment_success"),
  orderReference: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  transactionId: z.string().trim().min(1).optional(),
  customerEmail: z.email().optional(),
  mode: z.enum(["TEST", "LIVE"]).default("TEST"),
  skipTransactionVerification: z.boolean().default(true),
});
