import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const createPortalSessionSchema = z.object({
  customerId: z.uuid(),
  returnUrl: z.url().optional(),
  expiresInMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  metadata: metadataSchema,
});

export const portalSessionTokenParamsSchema = z.object({
  token: z.string().trim().min(16),
});

export const portalSessionIdParamsSchema = z.object({
  id: z.uuid(),
});

export const listPortalSessionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
  customerId: z.uuid().optional(),
});
