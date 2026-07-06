import { z } from "zod";

export const runDueBillingSchema = z.object({
  businessId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  mode: z.enum(["TEST", "LIVE"]).optional(),
  subscriptionId: z.uuid().optional(),
  skipTransactionVerification: z.boolean().default(true),
});

export const fastForwardSubscriptionParamsSchema = z.object({
  id: z.uuid(),
});

export const fastForwardSubscriptionBillingSchema = z.object({
  businessId: z.uuid(),
  mode: z.enum(["TEST", "LIVE"]),
  minutesAgo: z.number().int().min(0).max(1440).default(1),
});
