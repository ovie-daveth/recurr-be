import { z } from "zod";

export const runCleanupSchema = z.object({
  businessId: z.uuid().optional(),
  mode: z.enum(["TEST", "LIVE"]).optional(),
  stalePaymentProcessingMinutes: z.number().int().positive().max(1440).optional(),
  staleIncompleteSubscriptionHours: z.number().int().positive().max(720).optional(),
  idempotencyRetentionDays: z.number().int().positive().max(365).optional(),
});
