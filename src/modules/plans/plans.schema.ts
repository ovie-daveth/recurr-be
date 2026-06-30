import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const planIdParamsSchema = z.object({
  id: z.uuid(),
});

export const createPlanSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(2).max(80),
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).toUpperCase().default("NGN"),
  interval: z.enum(["DAY", "WEEK", "MONTH", "YEAR", "CUSTOM"]),
  intervalCount: z.number().int().positive().default(1),
  trialDays: z.number().int().nonnegative().default(0),
  metadata: metadataSchema,
});

export const updatePlanSchema = createPlanSchema.partial();
