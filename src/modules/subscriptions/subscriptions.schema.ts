import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const subscriptionIdParamsSchema = z.object({
  id: z.uuid(),
});

export const createSubscriptionSchema = z.object({
  customerId: z.uuid(),
  planId: z.uuid(),
  paymentMethodId: z.uuid(),
  trialDays: z.number().int().nonnegative().max(365).optional(),
  metadata: metadataSchema,
});

export const listSubscriptionsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([
      "INCOMPLETE",
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
      "PAUSED",
      "CANCELLED",
      "EXPIRED",
    ])
    .optional(),
});

export const cancelSubscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean().default(false),
});
