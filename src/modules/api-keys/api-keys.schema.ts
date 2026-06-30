import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  mode: z.enum(["TEST", "LIVE"]),
  expiresAt: z.iso.datetime().optional(),
});

export const apiKeyIdParamsSchema = z.object({
  businessId: z.uuid(),
  id: z.uuid(),
});
