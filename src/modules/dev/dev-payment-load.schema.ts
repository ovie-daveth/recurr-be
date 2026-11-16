import { z } from "zod";

export const simulateMockLoadSchema = z.object({
  businessId: z.uuid(),
  paymentMethodId: z.uuid(),
  amountMinor: z.number().int().min(100).max(500_000_000).default(500_000),
});
