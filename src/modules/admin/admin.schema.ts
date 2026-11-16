import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

export const merchantIdParamsSchema = z.object({
  merchantId: z.uuid(),
});

export const merchantApiKeyParamsSchema = z.object({
  merchantId: z.uuid(),
  businessId: z.uuid(),
  apiKeyId: z.uuid(),
});

export const listMerchantsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(["PENDING_VERIFICATION", "ACTIVE", "DISABLED", "DELETED"])
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const adminEmailSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .refine((value) => !/[\r\n]/.test(value), "Subject must be a single line"),
  message: z.string().trim().min(1).max(10_000),
});
