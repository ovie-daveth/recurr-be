import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const invoiceIdParamsSchema = z.object({
  id: z.uuid(),
});

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([
      "DRAFT",
      "OPEN",
      "PAYMENT_PROCESSING",
      "PAID",
      "PAYMENT_FAILED",
      "VOID",
      "UNCOLLECTIBLE",
    ])
    .optional(),
  subscriptionId: z.uuid().optional(),
  customerId: z.uuid().optional(),
});

export const payInvoiceSchema = z
  .object({
    metadata: metadataSchema,
  })
  .default({});
