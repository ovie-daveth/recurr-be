import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

export const paymentAttemptIdParamsSchema = z.object({
  id: z.uuid(),
});

export const listPaymentAttemptsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([
      "PENDING",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "REQUIRES_ACTION",
      "ABANDONED",
    ])
    .optional(),
  invoiceId: z.uuid().optional(),
  subscriptionId: z.uuid().optional(),
  customerId: z.uuid().optional(),
});
