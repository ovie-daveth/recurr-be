import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

export const operationalLogIdParamsSchema = z.object({
  businessId: z.uuid(),
  logId: z.uuid(),
});

export const operationalLogsBusinessParamsSchema = z.object({
  businessId: z.uuid(),
});

export const listOperationalLogsQuerySchema = paginationQuerySchema.extend({
  severity: z.enum(["INFO", "WARN", "ERROR"]).optional(),
  event: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(["TEST", "LIVE"]).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  entityId: z.string().trim().min(1).max(120).optional(),
  requestId: z.string().trim().min(1).max(120).optional(),
});
