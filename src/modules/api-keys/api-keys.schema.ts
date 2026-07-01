import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  mode: z.enum(["TEST", "LIVE"]),
  expiresAt: z.iso.datetime().optional(),
});

export const apiKeyIdParamsSchema = z.object({
  businessId: z.uuid(),
  id: z.uuid(),
});

export const listApiKeysQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
  mode: z.enum(["TEST", "LIVE"]).optional(),
});
