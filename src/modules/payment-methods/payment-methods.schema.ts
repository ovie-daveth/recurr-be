import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const setupPaymentMethodParamsSchema = z.object({
  id: z.uuid(),
});

export const setupPaymentMethodCheckoutSchema = z.object({
  callbackUrl: z.url().optional(),
  metadata: metadataSchema,
});
