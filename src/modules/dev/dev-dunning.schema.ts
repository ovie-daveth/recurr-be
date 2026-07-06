import { z } from "zod";

export const runDueDunningSchema = z.object({
  businessId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  mode: z.enum(["TEST", "LIVE"]).optional(),
  subscriptionId: z.uuid().optional(),
  invoiceId: z.uuid().optional(),
  dunningAttemptId: z.uuid().optional(),
  skipTransactionVerification: z.boolean().default(true),
});
