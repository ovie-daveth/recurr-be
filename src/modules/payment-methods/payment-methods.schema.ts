import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const setupPaymentMethodParamsSchema = z.object({
  id: z.uuid(),
});

export const paymentMethodParamsSchema = z.object({
  id: z.uuid(),
  paymentMethodId: z.uuid(),
});

export const listPaymentMethodsQuerySchema = z.object({
  status: z.enum(["PENDING_SETUP", "ACTIVE", "DISABLED", "EXPIRED"]).optional(),
});

export const setupPaymentMethodCheckoutSchema = z.object({
  callbackUrl: z.url().optional(),
  metadata: metadataSchema,
});
